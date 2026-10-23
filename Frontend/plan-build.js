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

function formatCustomer(date) {
    return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "short",
    }).format(date);
}

function timeLeft(deadline, now) {
    const ms = deadline.getTime() - now.getTime();
    const hours = Math.round(Math.abs(ms) / 3600000);
    const days = Math.round(Math.abs(ms) / 86400000);
    const span = hours < 48 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"}`;
    return ms >= 0 ? `${span} from your time now` : `${span} ago`;
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

function isTask(action) {
    const who = action.who_to_contact;
    const when = (action.when || "").toLowerCase();
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
    return CATHAY.legs
        .filter((leg) => leg.airport_service_id === airportServiceId && present.has(leg.leg))
        .filter((leg) => ids[leg.leg] === service.airport_id)
        .map((leg) => leg.leg);
}

function stageFits(stage, matchedLegs) {
    if (stage === "arrival and transfer") {
        return matchedLegs.includes("transit") || matchedLegs.includes("arrival");
    }
    if (stage === "check-in" || stage === "boarding") return matchedLegs.includes("departure");
    return false;
}

function itemFromAction(action, serviceName, parentSource, booking, description) {
    const source = action.source || parentSource;
    return {
        key: `${serviceName}|${action.step}|${action.stage}`,
        stage: action.stage,
        kind: isTask(action) ? "task" : "note",
        service: serviceName,
        description: description || "",
        what: action.what_to_do,
        who: action.who_to_contact === "None" ? "" : action.who_to_contact,
        when: action.when,
        due: isTask(action) ? dueFrom(action.when, booking.departs_at) : null,
        link: linkFor(source),
        gap: false,
    };
}

function buildPlan(passengerId) {
    const passenger = CATHAY.passengers.find((row) => row.passenger_id === passengerId);
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
    const yes = CATHAY.survey.filter((row) => row.passenger_id === passengerId && row.answer === "yes");
    const items = [];
    const seen = new Set();

    function add(item) {
        if (seen.has(item.key)) return;
        seen.add(item.key);
        items.push(item);
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
            const matched = airportMatches(answer.airport_service_id, booking);
            CATHAY.airport_actions
                .filter((action) => action.airport_service_id === answer.airport_service_id && stageFits(action.stage, matched))
                .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
        }
        if (answer.need_id) {
            const name = answer.need_id === 48 ? "Sign language" : "Text reminders";
            add({
                key: `gap|${answer.need_id}`,
                stage: "before travel",
                kind: "note",
                service: name,
                description: "",
                what: `${name}. Cathay and the airport do not offer this.`,
                who: "",
                when: "",
                due: null,
                link: null,
                gap: true,
            });
        }
    });

    if (groupIds.has(1)) {
        const service = SERVICES.get(7);
        CATHAY.service_actions
            .filter((action) => action.service_id === 7)
            .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
    }
    if (groupIds.has(3)) {
        const matched = airportMatches(4, booking);
        const service = AIR_SERVICES.get(4);
        CATHAY.airport_actions
            .filter((action) => action.airport_service_id === 4 && stageFits(action.stage, matched))
            .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
    }
    if (groupIds.has(2)) {
        const matched = airportMatches(5, booking);
        const service = AIR_SERVICES.get(5);
        CATHAY.airport_actions
            .filter((action) => action.airport_service_id === 5 && stageFits(action.stage, matched))
            .forEach((action) => add(itemFromAction(action, service.service_name, service.source, booking, service.description)));
    }

    tags.forEach((tag) => {
        if (!tag.detail) return;
        if (tag.name !== "WCHS" && tag.name !== "WCHR") return;
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

    const stages = STAGES.map((stage) => ({
        id: stage,
        label: STAGE_LABEL[stage],
        items: items.filter((item) => STAGE_OF[item.stage] === stage),
    }));

    return { passenger, booking, tags, groups, stages };
}

function tripLine(booking) {
    const from = airportCode(booking.departure_airport_id);
    const to = airportCode(booking.arrival_airport_id);
    const via = booking.transit_airport_id ? ` via ${airportCode(booking.transit_airport_id)}` : "";
    return `${from} to ${to}${via} · ${formatWhen(booking.departs_at)}`;
}
