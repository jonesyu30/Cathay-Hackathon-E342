/* Turns a saved survey into a trip plan. Does not write to the database. */

const STAGES = [
    "before travel",
    "check-in and boarding",
    "in flight",
    "arrival and transfer",
];

const STAGE_LABEL = {
    "before travel": "Before travel",
    "check-in and boarding": "Check-in & Boarding",
    "in flight": "In-flight",
    "arrival and transfer": "Arrival & Transfer",
};

const STAGE_OF = {
    "before travel": "before travel",
    "check-in": "check-in and boarding",
    boarding: "check-in and boarding",
    "in flight": "in flight",
    "arrival and transfer": "arrival and transfer",
};

const CONTACT_WHO = new Set([
    "Customer Care",
    "Customer Care or your travel agent",
    "Reservations",
    "Local Reservations office",
    "Your physician",
    "AFCD",
    "Check-in staff",
    "Cathay ground staff",
    "Gate staff",
]);

function byId(list, key) {
    const map = new Map();
    list.forEach((row) => map.set(row[key], row));
    return map;
}

const SERVICES = byId(CATHAY.services, "service_id");
const AIR_SERVICES = byId(CATHAY.airport_services, "airport_service_id");
const GROUPS = byId(CATHAY.groups, "group_id");
const TAGS = byId(CATHAY.tags, "tag_id");
const AIRPORTS = byId(CATHAY.airports, "airport_id");

function airportCode(id) {
    const row = AIRPORTS.get(id);
    return row ? row.iata : "";
}

const PLACE_NAME = { HKG: "Hong Kong", LHR: "London", NRT: "Tokyo" };

function placeName(id) {
    const row = AIRPORTS.get(id);
    if (!row) return "";
    return PLACE_NAME[row.iata] || row.name.replace(/ International Airport$/, "");
}

function customerNow() {
    return new Date();
}

function customerZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function hongKongTime(value) {
    return new Date(String(value).replace(" ", "T") + "+08:00");
}

function formatWhen(value) {
    const date = typeof value === "string" ? hongKongTime(value) : value;
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(date);
}

function formatTripDay(value) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(hongKongTime(value));
}

function formatTripClock(value) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(hongKongTime(value));
}

function formatTripWhen(value) {
    return `${formatTripDay(value)} at ${formatTripClock(value)} Hong Kong Time`;
}

function placeWithCode(id) {
    const name = placeName(id);
    const code = airportCode(id);
    if (!name) return code;
    if (!code) return name;
    return `${name} (${code})`;
}

function formatCustomer(date) {
    const time = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(date);
    const day = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(date);
    return `${time} · ${day}`;
}

function timeLeft(deadline, now) {
    const ms = deadline.getTime() - now.getTime();
    const totalHours = Math.floor(Math.abs(ms) / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const parts = [];
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (hours || !days) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    const span = parts.join(" ");
    return ms >= 0 ? `${span} left` : `${span} ago`;
}

function replyLabel(reply, answer) {
    if (!answer) return "";
    if (reply === "yesno") return answer === "yes" ? "Yes" : "No";
    return answer;
}

function actionLine(item) {
    const what = item.what || "";
    const who = item.who || "";
    if (!who || !/\bthem\b/i.test(what)) return what;
    return what.replace(/\bthem\b/gi, who);
}

function noticeHours(whenText) {
    const when = whenText || "";
    const range = when.match(/(\d+)\s*[–-]\s*(\d+)\s*hours/i);
    if (range) return Number(range[1]);
    const hours = when.match(/at least (\d+) hours/i);
    if (hours) return Number(hours[1]);
    const days = when.match(/at least (\d+) days/i);
    if (days) return Number(days[1]) * 24;
    return null;
}

function dueFrom(whenText, departsAt) {
    const span = noticeHours(whenText);
    if (!span) return null;
    const deadline = new Date(hongKongTime(departsAt).getTime() - span * 3600000);
    const now = customerNow();
    return {
        at: deadline.toISOString(),
        label: formatCustomer(deadline),
        left: timeLeft(deadline, now),
        zone: customerZone(),
    };
}

function skipAction(action, booking) {
    const what = action.what_to_do || "";
    const when = action.when || "";
    if (what.includes("10 or more wheelchairs") && booking.party_size < 10) return true;
    if (when.includes("8 hours or longer")) return true;
    if (what.includes("If the model is not one of those")) return true;
    return false;
}

function replyKind(action) {
    return action.reply || "";
}

function isTask(action) {
    return action.kind === "task";
}

function needsStaffCall(action) {
    const who = action.who_to_contact;
    const when = (action.when || action.applies_when || "").toLowerCase();
    if (!CONTACT_WHO.has(who)) return false;
    if (when.startsWith("no booking") || when.startsWith("no advance")) return false;
    return true;
}

function linkFor(source) {
    if (!source) return null;
    const airport = source.includes("hongkongairport.com");
    return { href: source, label: airport ? "Airport page" : "Cathay page" };
}

function legsPresent(booking) {
    const legs = new Set();
    if (booking.departure_airport_id) legs.add("departure");
    if (booking.transit_airport_id) legs.add("transit");
    if (booking.arrival_airport_id) legs.add("arrival");
    return legs;
}

function airportMatches(airportServiceId, booking) {
    const service = AIR_SERVICES.get(airportServiceId);
    if (!service) return [];
    const present = legsPresent(booking);
    const ids = {
        departure: booking.departure_airport_id,
        transit: booking.transit_airport_id,
        arrival: booking.arrival_airport_id,
    };
    return CATHAY.airport_service_legs
        .filter((leg) => leg.airport_service_id === airportServiceId && present.has(leg.leg))
        .filter((leg) => ids[leg.leg] === service.airport_id)
        .map((leg) => leg.leg);
}

function stageFits(stage, matchedLegs) {
    if (!matchedLegs.length) return false;
    if (stage === "before travel") return true;
    if (stage === "arrival and transfer") {
        return matchedLegs.includes("transit") || matchedLegs.includes("arrival");
    }
    if (stage === "check-in" || stage === "boarding") return matchedLegs.includes("departure");
    return false;
}

function questionList(action, key) {
    const replies = String(action.reply || "").split(",").map((reply) => reply.trim()).filter(Boolean);
    const label = { time: "Arrival time" };
    return replies.map((reply) => ({
        key: replies.length > 1 ? `${key}|${reply}` : key,
        reply,
        what: replies.length > 1 ? (label[reply] || "") : action.what_to_do,
    }));
}

function itemFromAction(action, serviceName, parentSource, booking, description) {
    const source = action.source || parentSource;
    const stage = action.stage;
    const key = `${serviceName}|${action.step}|${stage}`;
    const questions = questionList(action, key);
    return {
        key,
        stage,
        kind: isTask(action) ? "task" : "note",
        service: serviceName,
        description: description || "",
        what: action.what_to_do,
        reply: questions.length > 1 ? "form" : replyKind(action),
        questions,
        who: action.who_to_contact === "None" ? "" : action.who_to_contact,
        when: action.when,
        due: isTask(action) ? dueFrom(action.when, booking.departs_at) : null,
        link: linkFor(source),
        gap: false,
    };
}

function addRuleTasks(yes, add) {
    const names = new Set();
    yes.forEach((answer) => {
        if (!answer.service_id) return;
        const service = SERVICES.get(answer.service_id);
        if (service) names.add(service.service_name);
    });
    const seen = new Set();
    (CATHAY.rule_links || []).forEach((link) => {
        if (!link.service_name || !names.has(link.service_name) || seen.has(link.rule_id)) return;
        const rule = (CATHAY.rules || []).find((row) => row.rule_id === link.rule_id);
        if (!rule || rule.kind !== "task") return;
        seen.add(rule.rule_id);
        add({
            key: `rule|${rule.rule_id}`,
            stage: "before travel",
            kind: "task",
            service: rule.name,
            description: "",
            what: rule.requirement,
            who: "",
            when: rule.applies_when,
            due: null,
            link: linkFor(rule.source),
            gap: false,
        });
    });
}

function coveredRuleIds(yes) {
    const needIds = new Set();
    yes.forEach((answer) => {
        if (answer.service_id) {
            CATHAY.need_services
                .filter((row) => row.service_id === answer.service_id)
                .forEach((row) => needIds.add(row.need_id));
        }
        if (answer.airport_service_id) {
            CATHAY.needs
                .filter((row) => row.airport_service_id === answer.airport_service_id)
                .forEach((row) => needIds.add(row.need_id));
        }
    });
    const covered = new Set();
    (CATHAY.rule_links || []).forEach((link) => {
        if (link.need_id && needIds.has(link.need_id)) covered.add(link.rule_id);
    });
    return covered;
}

function addConditionRules(passengerId, groupIds, yes, add) {
    const conditions = new Set(
        (CATHAY.passenger_conditions || [])
            .filter((row) => row.passenger_id === passengerId)
            .map((row) => row.show_when)
    );
    if (!conditions.size) return;
    const covered = coveredRuleIds(yes);
    const seen = new Set();
    (CATHAY.rule_links || []).forEach((link) => {
        if (!groupIds.has(link.group_id) || !conditions.has(link.show_when)) return;
        if (covered.has(link.rule_id) || seen.has(link.rule_id)) return;
        const rule = (CATHAY.rules || []).find((row) => row.rule_id === link.rule_id);
        if (!rule) return;
        seen.add(link.rule_id);
        const task = rule.kind === "task";
        add({
            key: `rule|${rule.rule_id}`,
            stage: "before travel",
            kind: task ? "task" : "note",
            service: rule.name,
            description: "",
            what: rule.requirement,
            reply: "",
            questions: [],
            who: "",
            when: task ? rule.applies_when : "",
            due: null,
            link: linkFor(rule.source),
            gap: false,
            reading: !task,
        });
    });
}

function addAutomatic(groupIds, booking, add) {
    const addedServices = new Set();
    CATHAY.need_services.forEach((link) => {
        if (link.service_id !== 7 && link.service_id !== 16) return;
        const need = CATHAY.needs.find((row) => row.need_id === link.need_id);
        if (!need || !groupIds.has(need.group_id) || addedServices.has(link.service_id)) return;
        addedServices.add(link.service_id);
        const service = SERVICES.get(link.service_id);
        if (!service) return;
        CATHAY.service_actions
            .filter((action) => action.service_id === link.service_id && !skipAction(action, booking))
            .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
    });
    const addedAirports = new Set();
    CATHAY.needs.forEach((need) => {
        if (!groupIds.has(need.group_id) || need.airport_has_service !== "yes" || !need.airport_service_id) return;
        if (/sunflower/i.test(need.service_name) || addedAirports.has(need.airport_service_id)) return;
        const matched = airportMatches(need.airport_service_id, booking);
        if (!matched.length) return;
        addedAirports.add(need.airport_service_id);
        const service = AIR_SERVICES.get(need.airport_service_id);
        if (!service) return;
        CATHAY.airport_service_actions
            .filter((action) => action.airport_service_id === need.airport_service_id && stageFits(action.stage, matched))
            .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
    });
}

function buildPlan(passengerId) {
    const passenger = CATHAY.passengers.find((row) => row.passenger_id === passengerId);
    if (!passenger) {
        throw new Error(`Passenger ${passengerId} is missing from the plan catalog. Check the server's passenger data.`);
    }
    const booking = CATHAY.bookings.find((row) => row.passenger_id === passengerId);
    const profile = CATHAY.profile_groups.filter((row) => row.passenger_id === passengerId);
    const tags = profile
        .filter((row) => row.tag_id)
        .map((row) => TAGS.get(row.tag_id));
    const groups = profile.map((row) => {
        const group = GROUPS.get(row.group_id);
        return {
            name: group.name,
            acronym: group.acronym,
            tag: row.tag_id ? TAGS.get(row.tag_id).name : "",
        };
    });
    const groupIds = new Set(profile.map((row) => row.group_id));
    const yes = CATHAY.survey_answers.filter((row) => row.passenger_id === passengerId && row.answer === "yes");
    const items = [];
    const seen = new Set();

    function add(item) {
        if (!yes.length && item.kind === "task") return;
        if (seen.has(item.key)) return;
        seen.add(item.key);
        items.push(item);
    }

    let primarySunflowerId = null;
    for (const leg of ["departure", "transit", "arrival"]) {
        const found = yes.find((answer) => {
            if (!answer.airport_service_id) return false;
            const svc = AIR_SERVICES.get(answer.airport_service_id);
            if (!svc || !/sunflower/i.test(svc.service_name)) return false;
            return airportMatches(answer.airport_service_id, booking).includes(leg);
        });
        if (found) {
            primarySunflowerId = found.airport_service_id;
            break;
        }
    }

    yes.forEach((answer) => {
        if (answer.service_id) {
            const service = SERVICES.get(answer.service_id);
            CATHAY.service_actions
                .filter((action) => action.service_id === answer.service_id && !skipAction(action, booking))
                .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
            if (answer.service_id === 19) {
                add({
                    key: `${service.service_name}|to|check-in`,
                    stage: "check-in",
                    kind: "note",
                    service: service.service_name,
                    description: service.description,
                    what: "A staff member will guide you from check-in through boarding to the aircraft.",
                    who: "Airport personnel",
                    when: "From check-in through boarding",
                    due: null,
                    link: linkFor(service.source),
                    gap: false,
                });
            }
        }
        if (answer.airport_service_id) {
            const service = AIR_SERVICES.get(answer.airport_service_id);
            const isSunflower = service && /sunflower/i.test(service.service_name);
            if (isSunflower && primarySunflowerId && answer.airport_service_id !== primarySunflowerId) return;
            const matched = airportMatches(answer.airport_service_id, booking);
            CATHAY.airport_service_actions
                .filter((action) => {
                    if (action.airport_service_id !== answer.airport_service_id) return false;
                    if (!stageFits(action.stage, matched)) return false;
                    if (isSunflower && action.stage === "arrival and transfer" && !matched.includes("transit")) return false;
                    return true;
                })
                .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
        }
    if (answer.need_id) {
            const need = CATHAY.needs.find((row) => row.need_id === answer.need_id);
            const name = need ? need.service_name : "Requested service";
            const description = answer.need_id === 48
                ? "The airport will find and provide a sign language interpreter."
                : answer.need_id === 49
                    ? "We will send digital notifications when announcements are made."
                    : "";
            add({
                key: `gap|${answer.need_id}`,
                stage: "before travel",
                kind: "note",
                service: name,
                description,
                what: description,
                who: "",
                when: "",
                due: null,
                link: null,
                gap: false,
            });
        }
    });

    addAutomatic(groupIds, booking, add);

    addRuleTasks(yes, add);
    addConditionRules(passengerId, groupIds, yes, add);

    tags.forEach((tag) => {
        if (!tag.detail) return;
        if (tag.name !== "WCHS") return;
        const service = SERVICES.get(1);
        add({
            key: `tag|${tag.name}`,
            stage: "boarding",
            kind: "note",
            service: tag.name,
            description: "",
            what: tag.detail,
            who: "Gate staff",
            when: "",
            due: null,
            link: linkFor(service.source),
            gap: false,
        });
    });

    const unique = mergeServiceTasks(collapseSameService(items));
    const stages = STAGES.map((stage) => ({
        id: stage,
        label: STAGE_LABEL[stage],
        items: unique.filter((item) => STAGE_OF[item.stage] === stage),
    }));

    return { passenger, booking, tags, groups, stages };
}

function mergeServiceTasks(items) {
    const byService = new Map();
    items.forEach((item) => {
        if (item.kind !== "task") return;
        const groupKey = `${item.stage}|${item.service}`;
        const group = byService.get(groupKey) || [];
        group.push(item);
        byService.set(groupKey, group);
    });
    const emitted = new Set();
    const merged = [];
    items.forEach((item) => {
        if (item.kind !== "task") {
            merged.push(item);
            return;
        }
        const groupKey = `${item.stage}|${item.service}`;
        if (emitted.has(groupKey)) return;
        emitted.add(groupKey);
        const parts = byService.get(groupKey);
        if (parts.length === 1 && !parts[0].reply) {
            merged.push(parts[0]);
            return;
        }
        const questions = parts.flatMap((part) => (part.questions && part.questions.length ? part.questions : []));
        const asksArrival = questions.some((question) => question.reply === "time");
        const stage = asksArrival ? "before travel" : parts[0].stage;
        const what = [...new Set(parts.map((part) => part.what).filter(Boolean))].join(" ");
        merged.push({
            ...parts[0],
            key: `${item.service}|${stage}`,
            stage,
            what,
            reply: questions.length ? "form" : "",
            questions,
        });
    });
    return merged;
}

function collapseSameService(items) {
    const taskHere = new Set(
        items.filter((item) => item.kind === "task").map((item) => `${item.stage}|${item.service}`)
    );
    const visible = items.filter((item) => item.kind === "task" || !taskHere.has(`${item.stage}|${item.service}`));
    const grouped = new Map();
    const order = [];
    visible.forEach((item) => {
        const key = item.kind === "task" ? item.key : `${item.stage}|${item.service}|note`;
        const current = grouped.get(key);
        if (!current) {
            grouped.set(key, { ...item, key: item.kind === "task" ? item.key : key });
            order.push(key);
            return;
        }
        if (item.what && !current.what.includes(item.what)) current.what = `${current.what} ${item.what}`;
        if (item.due && (!current.due || item.due.at < current.due.at)) current.due = item.due;
    });
    return order.map((key) => grouped.get(key));
}

function tripDisplay(booking) {
    const via = booking.transit_airport_id ? ` via ${placeWithCode(booking.transit_airport_id)}` : "";
    const detail = [formatTripClock(booking.departs_at), formatTripDay(booking.departs_at), booking.flight || ""].filter(Boolean);
    return {
        places: `${placeWithCode(booking.departure_airport_id)} to ${placeWithCode(booking.arrival_airport_id)}${via}`,
        when: detail.join(" · "),
    };
}

function tripLine(booking) {
    const viaCode = booking.transit_airport_id ? ` via ${airportCode(booking.transit_airport_id)}` : "";
    const codes = `${airportCode(booking.departure_airport_id)} to ${airportCode(booking.arrival_airport_id)}${viaCode}`;
    return `${codes} · ${formatTripWhen(booking.departs_at)}`;
}

const CARE_CONTACT = {
    label: "Customer Care",
    phone: "+852 2747 3333",
    tel: "+85227473333",
    hours: "Hong Kong · daily 08:00–20:00",
    note: "CARE does not place the call. Use this brief while you speak.",
};

function serviceNeedsBooking(serviceId, booking) {
    return CATHAY.service_actions
        .filter((action) => action.service_id === serviceId && !skipAction(action, booking))
        .some((action) => needsStaffCall(action));
}

function airportNeedsBooking(airportServiceId, booking) {
    const matched = airportMatches(airportServiceId, booking);
    return CATHAY.airport_service_actions
        .filter((action) => action.airport_service_id === airportServiceId && stageFits(action.stage, matched))
        .some((action) => needsStaffCall(action));
}

function buildCareBrief(passengerId) {
    const view = buildPlan(passengerId);
    const yes = CATHAY.survey_answers.filter((row) => row.passenger_id === passengerId && row.answer === "yes");
    const services = [];
    const seen = new Set();

    yes.forEach((answer) => {
        let name = "";
        if (answer.service_id) {
            if (!serviceNeedsBooking(answer.service_id, view.booking)) return;
            const row = SERVICES.get(answer.service_id);
            name = row ? row.service_name : "";
        } else if (answer.airport_service_id) {
            if (!airportNeedsBooking(answer.airport_service_id, view.booking)) return;
            const row = AIR_SERVICES.get(answer.airport_service_id);
            name = row ? row.service_name : "";
        }
        if (!name || seen.has(name)) return;
        seen.add(name);
        services.push({ name });
    });

    const from = airportCode(view.booking.departure_airport_id);
    const to = airportCode(view.booking.arrival_airport_id);
    const when = formatTripWhen(view.booking.departs_at);
    const bullets = [
        `I am flying from ${from} to ${to} on ${when}.`,
        ...services.map((service) => `I need to book: ${service.name}.`),
        `Please help me arrange these with Customer Care.`,
    ];

    return {
        passenger: view.passenger,
        booking: view.booking,
        trip: tripLine(view.booking),
        services,
        contact: CARE_CONTACT,
        bullets,
        summaryText: bullets.map((line) => `• ${line}`).join("\n"),
    };
}
