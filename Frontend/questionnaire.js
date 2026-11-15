const KEY_BY_SERVICE = {
    1: "attendant", 2: "inflight", 3: "devices", 4: "aids", 5: "posture", 6: "seating", 7: "lav",
    8: "cane", 9: "dog", 10: "aidsHear", 11: "transmit", 12: "checkin", 13: "med", 14: "oxygen",
    15: "stretcher", 16: "fast", 17: "eat", 18: "escort", 19: "meet", 20: "brief", 21: "board",
    22: "seat", 23: "menu", 24: "poc", 25: "cpap", 26: "fremec"
};
const SERVICE_ID = Object.fromEntries(Object.entries(KEY_BY_SERVICE).map(([id, key]) => [key, Number(id)]));
const KEY_BY_AIRPORT = { 1: "caring", 2: "corner", 3: "sunflower", 4: "loops", 5: "tactile", 6: "courtesy" };
CATHAY.airport_services.forEach(row => {
    if (KEY_BY_AIRPORT[row.airport_service_id] == null) {
        KEY_BY_AIRPORT[row.airport_service_id] = "airport-" + row.airport_service_id;
    }
});
const AIRPORT_SERVICE_ID = Object.fromEntries(Object.entries(KEY_BY_AIRPORT).map(([id, key]) => [key, Number(id)]));
const AUTO_SERVICE_IDS = new Set([7, 16]);
const CHOICE_AIRPORT_IDS = new Set(
    CATHAY.airport_services.filter(row => /sunflower/i.test(row.service_name)).map(row => row.airport_service_id)
);

const SERVICES = {};
const SOURCES = {};
CATHAY.services.forEach(row => {
    const key = KEY_BY_SERVICE[row.service_id];
    if (!key) return;
    SERVICES[key] = [row.service_name, row.description];
    SOURCES[key] = row.source || "";
});
CATHAY.airport_services.forEach(row => {
    const key = KEY_BY_AIRPORT[row.airport_service_id];
    SERVICES[key] = [row.service_name, row.description];
    SOURCES[key] = row.source || "";
});
CATHAY.needs.filter(row => row.cathay_has_service === "no" && row.airport_has_service === "no").forEach(row => {
    const key = row.service_name === "Sign language" ? "sign" : row.service_name === "Text reminders" ? "text" : null;
    if (!key || SERVICES[key]) return;
    SERVICES[key] = [row.service_name, `Cathay and the airport do not offer ${row.service_name.toLowerCase()}.`];
    SOURCES[key] = "";
});

function keyForNeed(need) {
    if (need.cathay_has_service === "no" && need.airport_has_service === "no") {
        if (need.service_name === "Sign language") return "sign";
        if (need.service_name === "Text reminders") return "text";
        return null;
    }
    if (need.airport_has_service === "yes") return KEY_BY_AIRPORT[need.airport_service_id];
    const link = CATHAY.need_services.find(row => row.need_id === need.need_id);
    return link ? KEY_BY_SERVICE[link.service_id] : null;
}

const GROUP_SERVICES = {};
const AUTO_CATHAY = {};
const GROUP_AIRPORT = {};
CATHAY.groups.forEach(group => {
    GROUP_SERVICES[group.name] = [];
    AUTO_CATHAY[group.name] = [];
    GROUP_AIRPORT[group.name] = [];
});
CATHAY.needs.slice().sort((a, b) => a.need_id - b.need_id).forEach(need => {
    const group = CATHAY.groups.find(row => row.group_id === need.group_id);
    const key = keyForNeed(need);
    if (!group || !key) return;
    const link = CATHAY.need_services.find(row => row.need_id === need.need_id);
    if (link && AUTO_SERVICE_IDS.has(link.service_id)) {
        AUTO_CATHAY[group.name].push(key);
        return;
    }
    if (need.airport_has_service === "yes" && !CHOICE_AIRPORT_IDS.has(need.airport_service_id)) {
        GROUP_AIRPORT[group.name].push(key);
        return;
    }
    GROUP_SERVICES[group.name].push(key);
});

const LEGS = {};
const AIRPORT_SERVICE_ROWS = {};
CATHAY.airport_services.forEach(row => {
    const key = KEY_BY_AIRPORT[row.airport_service_id];
    LEGS[key] = CATHAY.airport_service_legs.filter(leg => leg.airport_service_id === row.airport_service_id).map(leg => leg.leg);
    AIRPORT_SERVICE_ROWS[key] = row.airport_id;
});

const AIRPORTS = CATHAY.airports.map(row => ({
    airport_id: row.airport_id,
    iata: row.iata,
    name: row.name,
    place: row.name
}));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BOOKINGS = CATHAY.bookings.slice().sort((a, b) => a.departs_at.localeCompare(b.departs_at)).map(row => {
    const [date, time] = row.departs_at.split(" ");
    const [year, month, day] = date.split("-").map(Number);
    const when = `${day} ${MONTHS[month - 1]} ${year}`;
    const flight = row.flight || "";
    return {
        id: String(row.booking_id),
        passenger_id: row.passenger_id,
        time,
        when,
        flight,
        detail: [time, when, flight].filter(Boolean).join(" · "),
        departure_airport_id: row.departure_airport_id,
        transit_airport_id: row.transit_airport_id || null,
        arrival_airport_id: row.arrival_airport_id
    };
});

function linked(id, text) {
    return text || (SERVICES[id] ? SERVICES[id][0] : id);
}
function noticeFor(id) {
    const serviceId = SERVICE_ID[id];
    const airportId = AIRPORT_SERVICE_ID[id];
    const actions = (serviceId
        ? CATHAY.service_actions.filter(row => row.service_id === serviceId)
        : airportId
            ? CATHAY.airport_service_actions.filter(row => row.airport_service_id === airportId)
            : []).slice().sort((a, b) => a.step - b.step);
    const needIds = serviceId
        ? CATHAY.need_services.filter(row => row.service_id === serviceId).map(row => row.need_id)
        : CATHAY.needs.filter(row => row.airport_service_id === airportId).map(row => row.need_id);
    const seen = new Set();
    const rules = [];
    (CATHAY.rule_links || []).forEach(link => {
        if (!link.need_id || !needIds.includes(link.need_id) || seen.has(link.rule_id)) return;
        const rule = (CATHAY.rules || []).find(row => row.rule_id === link.rule_id);
        if (!rule) return;
        seen.add(link.rule_id);
        rules.push(rule);
    });
    const steps = [];
    actions.forEach(action => {
        if (!steps.includes(action.what_to_do)) steps.push(action.what_to_do);
    });
    if (!steps.length && !rules.length) return null;
    const hrefs = [];
    if (SOURCES[id]) hrefs.push(SOURCES[id]);
    actions.forEach(action => {
        if (action.source && !hrefs.includes(action.source)) hrefs.push(action.source);
    });
    rules.forEach(rule => {
        if (rule.source && !hrefs.includes(rule.source)) hrefs.push(rule.source);
    });
    return {
        summary: steps.concat(rules.map(rule => rule.requirement)).join(" "),
        links: hrefs.map(href => ({ href }))
    };
}
function referLines(links) {
    if (!links || !links.length) return "";
    if (links.length === 1) {
        return `For more information, please refer to this <a href="${links[0].href}" target="_blank" rel="noopener noreferrer">page</a>.`;
    }
    const items = links.map((link, i) => `<a href="${link.href}" target="_blank" rel="noopener noreferrer">page ${i + 1}</a>`);
    const joined = items.length === 2
        ? `${items[0]} and ${items[1]}`
        : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
    return `For more information, please refer to ${joined}.`;
}
function noticeBody(id) {
    const notice = noticeFor(id);
    if (!notice) return "";
    const linksHtml = notice.links.length ? `<p class="notice-links">${referLines(notice.links)}</p>` : "";
    return `<div class="svc-notice"><p>${notice.summary}</p>${linksHtml}</div>`;
}
function moreInfo(id) {
    const notice = noticeFor(id);
    if (!notice || !notice.links.length) return "";
    return `<p class="request-more">${referLines(notice.links)}</p>`;
}
function requestedHtml() {
    const ids = Object.entries(state.decisions).filter(([, value]) => value === "yes").map(([id]) => id);
    if (!ids.length) return `<p class="select-plain">No additional services needed for this trip.</p>`;
    return `<div class="request-list">${ids.map(id => {
        const notice = noticeFor(id);
        const desc = (SERVICES[id] && SERVICES[id][1]) ? SERVICES[id][1] : "";
        const descHtml = desc ? `<p class="request-desc">${desc}</p>` : "";
        if (!notice) return `<article class="request-card"><div class="name">${linked(id)}</div>${descHtml}</article>`;
        const body = `${descHtml}<p class="request-body">${notice.summary}</p>${moreInfo(id)}`;
        return `<article class="request-card"><details class="auto-fold request-fold" open><summary><span class="name">${linked(id)}</span>${FOLD_ARROW}</summary>${body}</details></article>`;
    }).join("")}</div>`;
}
function noticesHtml() {
    const ids = Object.keys(state.decisions).filter(id => state.decisions[id] === "yes" && noticeFor(id));
    if (!ids.length) return "";
    return `<p class="auto-title">Please read this before you travel</p><div class="requested">${ids.map(id => `<details class="auto-fold notice-fold" open><summary><span>${linked(id)}</span>${FOLD_ARROW}</summary>${noticeBody(id)}</details>`).join("")}</div>`;
}
function keepLinks(root) {
    root.querySelectorAll("a").forEach(a => a.addEventListener("click", event => event.stopPropagation()));
}

const GROUP_HINTS = {
    "Mobility & Physical": "Wheelchair users, limited walking, and temporary injuries.",
    "Visual": "Blind or low-vision travellers.",
    "Hearing": "Deaf or hard-of-hearing travellers.",
    "Cognitive Support": "Memory, processing or learning needs.",
    "Neurodivergence": "Autism, ADHD and related conditions.",
    "Mental health & emotional": "Anxiety and other mental health conditions.",
    "Sensory sensitivity": "Sensitive to noise, light or crowds.",
    "Communication & Language": "Needing alternatives to speech or audio.",
    "Medical & Health": "Conditions needing equipment, medication or seating."
};


const BULB = `<svg class="bulb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6.5 6.5 0 0 0-3.8 11.7c.5.4.8 1 .8 1.6V17h6v-.7c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 3z"/></svg>`;


const state = {
    bookingIds: [],
    groups: [],
    gi: 0,
    mode: "notice",
    node: null,
    decisions: {},
    chosenBy: {},
    tag: "",
    tags: {},
    follow: null,
    safety: "",
    log: [],
    history: [],
    draft: [],
    draftGroup: null
};

const scrollEl = document.getElementById("scroll");
const footerEl = document.getElementById("footer");

function selectedBookings() {
    return BOOKINGS.filter(b => state.bookingIds.includes(b.id));
}
function airportById(id) {
    return AIRPORTS.find(airport => airport.airport_id === id) || null;
}
function flightPlace(id) {
    const airport = airportById(id);
    if (!airport) return "";
    return `${airport.place} (${airport.iata})`;
}
function flightRoute(trip) {
    return `${flightPlace(trip.departure_airport_id)} to ${flightPlace(trip.arrival_airport_id)}`;
}
function airportsOnLeg(leg) {
    const key = leg === "departure" ? "departure_airport_id" : leg === "arrival" ? "arrival_airport_id" : "transit_airport_id";
    const ids = [];
    selectedBookings().forEach(booking => {
        const id = booking[key];
        if (id && !ids.includes(id)) ids.push(id);
    });
    return ids.map(airportById).filter(Boolean);
}
function serviceMatches(id) {
    const legs = LEGS[id];
    const airportId = AIRPORT_SERVICE_ROWS[id];
    if (!legs || !airportId) return true;
    return legs.some(leg => airportsOnLeg(leg).some(airport => airport.airport_id === airportId));
}
function earliestSunflowerKey() {
    for (const leg of LEG_ORDER) {
        for (const airport of airportsOnLeg(leg)) {
            const match = CATHAY.airport_services.find(row =>
                CHOICE_AIRPORT_IDS.has(row.airport_service_id) &&
                row.airport_id === airport.airport_id &&
                serviceMatches(KEY_BY_AIRPORT[row.airport_service_id])
            );
            if (match) return KEY_BY_AIRPORT[match.airport_service_id];
        }
    }
    return null;
}
function visibleServices(group) {
    const primarySunflower = earliestSunflowerKey();
    return GROUP_SERVICES[group].filter(id => {
        if (!serviceMatches(id)) return false;
        const aId = AIRPORT_SERVICE_ID[id];
        if (aId && CHOICE_AIRPORT_IDS.has(aId)) {
            return id === primarySunflower;
        }
        return true;
    });
}
function serviceCard(id) {
    return `<article class="auto-item"><div class="name">${linked(id)}</div><p class="desc">${SERVICES[id][1]}</p></article>`;
}
function serviceGroup(label, ids) {
    if (!ids.length) return "";
    return `<details class="auto-fold auto-box"><summary><span>${label}</span>${FOLD_ARROW}</summary><div class="auto-list">${ids.map(serviceCard).join("")}</div></details>`;
}
const FOLD_ARROW = `<span class="fold-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>`;
const LEG_ORDER = ["departure", "transit", "arrival"];
function tripAirports() {
    const ids = [];
    LEG_ORDER.forEach(leg => {
        const key = leg === "departure" ? "departure_airport_id" : leg === "arrival" ? "arrival_airport_id" : "transit_airport_id";
        selectedBookings().forEach(booking => {
            const id = booking[key];
            if (id && !ids.includes(id)) ids.push(id);
        });
    });
    return ids;
}
function earliestLeg(id, airportId) {
    return LEG_ORDER.findIndex(leg => (LEGS[id] || []).includes(leg) && airportsOnLeg(leg).some(airport => airport.airport_id === airportId));
}
function airportSections(group) {
    const ids = GROUP_AIRPORT[group] || [];
    return tripAirports().map(airportId => {
        const airport = airportById(airportId);
        if (!airport) return "";
        const items = ids.filter(id => AIRPORT_SERVICE_ROWS[id] === airportId && earliestLeg(id, airportId) >= 0);
        items.sort((a, b) => earliestLeg(a, airportId) - earliestLeg(b, airportId) || ids.indexOf(a) - ids.indexOf(b));
        return serviceGroup(airport.name, items);
    }).filter(Boolean);
}
function offeredHtml(group) {
    const body = serviceGroup("Cathay", AUTO_CATHAY[group] || []) + airportSections(group).join("");
    if (!body) return "";
    return `<details class="auto-fold auto-offer result-card"><summary class="auto-title"><span>These services are offered automatically:</span>${FOLD_ARROW}</summary><div class="auto-body">${body}</div></details>`;
}

function render() {
    const notice = document.getElementById("screen-notice");
    const survey = document.getElementById("screen-survey");
    const chat = document.getElementById("screen-chat");
    document.getElementById("exit-dialog").classList.add("hidden");
    if (state.mode === "notice" || state.mode === "chat") {
        notice.classList.toggle("hidden", state.mode !== "notice");
        chat.classList.toggle("hidden", state.mode !== "chat");
        survey.classList.add("hidden");
        return;
    }
    notice.classList.add("hidden");
    chat.classList.add("hidden");
    survey.classList.remove("hidden");
    scrollEl.classList.remove("success-scroll");
    footerEl.hidden = false;
    scrollEl.innerHTML = "";
    footerEl.innerHTML = "";
    if (state.mode === "bookings") return bookings();
    if (state.mode === "groups") return groups();
    if (state.mode === "pick") return pick();
    if (state.mode === "follow") return follow();
    if (state.mode === "guide") return guide();
    if (state.mode === "done") return done();
    if (state.mode === "recorded") return recorded();
}

function kicker(text) {
    const p = document.createElement("p");
    p.className = "survey-kicker";
    p.textContent = text;
    scrollEl.appendChild(p);
}
function title(text) {
    const h = document.createElement("h1");
    h.className = "survey-q";
    h.textContent = text;
    scrollEl.appendChild(h);
}
function lead(text) {
    const p = document.createElement("p");
    p.className = "survey-lead";
    p.textContent = text;
    scrollEl.appendChild(p);
}
function note(html, extraClass) {
    const d = document.createElement("div");
    d.className = "result-card" + (extraClass ? " " + extraClass : "");
    d.innerHTML = html;
    scrollEl.appendChild(d);
}
function plain(text) {
    const p = document.createElement("p");
    p.className = "select-plain";
    p.textContent = text;
    scrollEl.appendChild(p);
}

function bookings() {
    title("Which flight do you need accessibility assistance for?");
    plain("Please select one.");
    const selectedId = state.bookingIds.length === 1 ? state.bookingIds[0] : null;
    const buttons = [];
    const list = document.createElement("div");
    list.className = "choice-list";
    BOOKINGS.forEach(trip => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice" + (trip.id === selectedId ? " on" : "");
        b.innerHTML = `<div class="name">${flightRoute(trip)}</div><div class="desc">${trip.detail}</div>`;
        b.onclick = () => {
            state.bookingIds = [trip.id];
            buttons.forEach(item => item.classList.remove("on"));
            b.classList.add("on");
            btn.disabled = false;
        };
        buttons.push(b);
        list.appendChild(b);
    });
    scrollEl.appendChild(list);
    const btn = primary("Continue");
    btn.disabled = !selectedId;
    btn.onclick = () => {
        if (state.bookingIds.length !== 1) return;
        remember();
        state.mode = "groups";
        render();
    };
    placeFooter(btn);
}

function choiceList(items, onPick) {
    const list = document.createElement("div");
    list.className = "choice-list";
    const buttons = [];
    let chosen = null;
    items.forEach(item => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice";
        b.innerHTML = `<div class="name">${item.label}</div>` + (item.next ? `<div class="next">${item.next}</div>` : "");
        b.onclick = () => {
            chosen = item;
            buttons.forEach(x => x.classList.remove("on"));
            b.classList.add("on");
            if (onPick) onPick(item);
        };
        buttons.push(b);
        list.appendChild(b);
    });
    scrollEl.appendChild(list);
    return () => chosen;
}

function primary(label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-start-chat";
    b.textContent = label;
    return b;
}

function snapshot() {
    return {
        mode: state.mode,
        node: state.node,
        gi: state.gi,
        bookingIds: state.bookingIds.slice(),
        groups: state.groups.slice(),
        decisions: { ...state.decisions },
        chosenBy: { ...state.chosenBy },
        tag: state.tag,
        tags: { ...state.tags },
        follow: state.follow ? { ...state.follow } : null,
        safety: state.safety,
        draft: state.draft.slice(),
        draftGroup: state.draftGroup
    };
}
function remember() {
    state.history.push(snapshot());
}
function back() {
    const prev = state.history.pop();
    if (!prev) return;
    state.mode = prev.mode;
    state.node = prev.node;
    state.gi = prev.gi;
    state.bookingIds = prev.bookingIds;
    state.groups = prev.groups;
    state.decisions = prev.decisions;
    state.chosenBy = prev.chosenBy;
    state.tag = prev.tag;
    state.tags = prev.tags || {};
    state.follow = prev.follow || null;
    state.safety = prev.safety;
    state.draft = prev.draft;
    state.draftGroup = prev.draftGroup;
    render();
}
function placeFooter(nextBtn) {
    const row = document.createElement("div");
    row.className = "row-btns";
    const prev = primary("Previous");
    prev.classList.add("btn-ghost");
    if (!state.history.length && state.mode === "bookings") prev.onclick = () => { state.mode = "notice"; render(); };
    else if (!state.history.length) prev.disabled = true;
    else prev.onclick = back;
    row.appendChild(prev);
    if (nextBtn) row.appendChild(nextBtn);
    else {
        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        row.appendChild(spacer);
    }
    footerEl.appendChild(row);
}

function groups() {
    title("What type of assistance do you need?");
    plain("Please select all that apply.");
    const selected = new Set(state.groups);
    const list = document.createElement("div");
    list.className = "choice-list";
    Object.keys(GROUP_SERVICES).forEach(name => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice" + (selected.has(name) ? " on" : "");
        b.innerHTML = `<div class="name">${name}</div><div class="desc">${GROUP_HINTS[name]}</div>`;
        b.onclick = () => {
            if (selected.has(name)) selected.delete(name); else selected.add(name);
            state.groups = Object.keys(GROUP_SERVICES).filter(n => selected.has(n));
            b.classList.toggle("on");
            btn.disabled = selected.size === 0;
        };
        list.appendChild(b);
    });
    scrollEl.appendChild(list);
    const btn = primary("Continue");
    btn.disabled = selected.size === 0;
    btn.onclick = () => {
        state.groups = Object.keys(GROUP_SERVICES).filter(name => selected.has(name));
        if (!state.groups.length) return;
        remember();
        state.gi = 0;
        state.mode = "pick";
        state.draft = [];
        state.draftGroup = null;
        render();
    };
    placeFooter(btn);
}

function pickHead(group, question) {
    const head = document.createElement("div");
    head.className = "pick-head";
    const name = document.createElement("p");
    name.className = "survey-q group-name";
    name.textContent = group;
    const q = document.createElement("h1");
    q.className = "survey-q";
    q.textContent = question;
    head.appendChild(name);
    head.appendChild(q);
    scrollEl.appendChild(head);
    return head;
}
function pick() {
    const group = state.groups[state.gi];
    const cathay = visibleServices(group).filter(id => state.decisions[id] !== "no");
    const offered = offeredHtml(group);
    const guideStart = FIRST[group] && resolve(FIRST[group]);
    if (!cathay.length) {
        if (!offered && guideStart) {
            state.node = guideStart;
            state.mode = "guide";
            render();
            return;
        }
        if (!offered && !guideStart) {
            advanceGroup();
            render();
            return;
        }
        pickHead(group, "Here is what is already available.");
        const holder = document.createElement("div");
        holder.innerHTML = offered;
        scrollEl.appendChild(holder.firstElementChild);
        const btn = primary("Continue");
        btn.onclick = () => {
            remember();
            if (guideStart) {
                state.node = guideStart;
                state.mode = "guide";
            } else {
                advanceGroup();
            }
            render();
        };
        placeFooter(btn);
        return;
    }
    pickHead(group, "Which of these options would best support you?");
    unsureButton(group);
    if (offered) {
        const holder = document.createElement("div");
        holder.innerHTML = offered;
        scrollEl.appendChild(holder.firstElementChild);
    }
    if (state.draftGroup !== group) {
        state.draft = [];
        state.draftGroup = group;
    }
    const picks = new Set(state.draft);
    const list = document.createElement("div");
    list.className = "choice-list";
    visibleServices(group).forEach(id => {
        if (state.decisions[id] === "no") return;
        const [name, desc] = SERVICES[id];
        const prior = state.decisions[id] === "yes";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice" + (prior ? " on locked" : "");
        let extra = "";
        if (prior && state.chosenBy[id] !== group) extra = `<div class="next">Already selected</div>`;
        b.innerHTML = `<div class="name">${linked(id)}</div><div class="desc">${desc}</div>${extra}`;
        keepLinks(b);
        if (!prior) {
            if (picks.has(id)) b.classList.add("on");
            b.onclick = () => {
                b.classList.toggle("on");
                if (picks.has(id)) picks.delete(id); else picks.add(id);
                state.draft = [...picks];
                sync();
            };
        }
        list.appendChild(b);
    });
    if (cathay.length) scrollEl.appendChild(list);
    const open = visibleServices(group).filter(id => !state.decisions[id]).length;
    const btn = primary("Continue");
    const sync = () => {
        const already = visibleServices(group).some(id => state.decisions[id] === "yes");
        btn.disabled = picks.size === 0 && !already && open > 0;
    };
    sync();
    btn.onclick = () => {
        remember();
        const chosen = [...picks];
        chosen.forEach(id => { state.decisions[id] = "yes"; state.chosenBy[id] = group; });
        state.draft = [];
        state.draftGroup = null;
        if (group === "Cognitive Support" || group === "Neurodivergence") {
            const start = resolve(FIRST[group]);
            if (start) {
                state.node = start;
                state.mode = "guide";
                render();
                return;
            }
        }
        if (!startFollow(group, chosen)) advanceGroup();
        render();
    };
    placeFooter(btn);
}

function unsureButton(group, parent) {
    const first = FIRST[group] && resolve(FIRST[group]);
    if (!first) return;
    const unsure = document.createElement("button");
    unsure.type = "button";
    unsure.className = "unsure";
    unsure.innerHTML = `${BULB}<span class="unsure-copy"><span class="unsure-line">Not sure which to choose?</span></span>`;
    unsure.onclick = () => {
        const start = resolve(first);
        remember();
        if (!start) { advanceGroup(); render(); return; }
        state.node = start;
        state.mode = "guide";
        render();
    };
    (parent || scrollEl).appendChild(unsure);
}
function assignTag(code) {
    state.tag = code;
    const group = currentGroup();
    const grp = CATHAY.groups.find(g => g.name === group);
    const tagRow = grp && CATHAY.tags.find(t => t.group_id === grp.group_id && t.name === code);
    if (tagRow) {
        state.tags[group] = code;
    }
}
function startFollow(group, ids) {
    const cabin = ids.some(id => id === "inflight" || id === "seat" || id === "escort");
    const eat = ids.includes("eat");
    let step = null;
    if (group === "Mobility & Physical" && cabin) {
        assignTag("WCHC");
        step = "evac";
    } else if (group === "Mobility & Physical" && ids.includes("attendant")) step = "aisle";
    else if (eat) step = "eat";
    if (!step) return false;
    state.follow = { step, thenEat: eat && step !== "eat" };
    state.mode = "follow";
    return true;
}
function nextFollow(step) {
    if (step) state.follow.step = step;
    else state.follow = null;
}
const FOLLOW = {
    aisle: {
        q: "Can you walk down the aisle to your seat?",
        choices: [
            { label: "No", go() { assignTag("WCHC"); nextFollow("evac"); } },
            { label: "Yes", go() { nextFollow("seat"); } }
        ]
    },
    seat: {
        q: "Can you move from the aisle into your seat by yourself?",
        choices: [
            { label: "No", go() { assignTag("WCHC"); nextFollow("evac"); } },
            { label: "Yes", go() { nextFollow("stairs"); } }
        ]
    },
    stairs: {
        q: "Can you climb the boarding stairs?",
        choices: [
            { label: "No", go() { assignTag("WCHS"); nextFollow(state.follow.thenEat ? "eat" : null); } },
            { label: "Yes", go() { nextFollow("long"); } }
        ]
    },
    long: {
        q: "Can you walk a long way through the airport?",
        choices: [
            { label: "No", go() { assignTag("WCHR"); nextFollow(state.follow.thenEat ? "eat" : null); } },
            { label: "Yes", go() { nextFollow(state.follow.thenEat ? "eat" : null); } }
        ]
    },
    evac: {
        q: "Can you leave the aircraft by yourself in an emergency?",
        choices: [
            { label: "No", go() { state.log.push("Bring your own assistant, someone who can help you leave the aircraft in an emergency."); nextFollow(state.follow.thenEat ? "eat" : null); } },
            { label: "Yes", go() { nextFollow(state.follow.thenEat ? "eat" : null); } }
        ]
    },
    eat: {
        q: "Do you need help eating, or only help preparing the meal?",
        choices: [
            { label: "I need help eating", go() { state.log.push("Bring someone who can help you eat. The crew can prepare the meal, but they cannot help you eat, drink, or take medication."); nextFollow(null); } },
            { label: "Only help preparing the meal", go() { nextFollow(null); } }
        ]
    }
};
function follow() {
    const group = state.groups[state.gi];
    const node = FOLLOW[state.follow.step];
    pickHead(group, node.q);
    const btn = primary("Continue");
    btn.disabled = true;
    const chosen = choiceList(node.choices.map(choice => ({
        label: choice.label,
        go() {
            remember();
            choice.go();
            if (!state.follow) advanceGroup();
            render();
        }
    })), () => { btn.disabled = false; });
    btn.onclick = () => {
        const item = chosen();
        if (!item) return;
        item.go();
    };
    placeFooter(btn);
}
function advanceGroup() {
    state.gi += 1;
    state.node = null;
    state.mode = state.gi >= state.groups.length ? "done" : "pick";
}

async function submitQuestionnaire() {
    const booking = BOOKINGS.find(b => b.id === state.bookingIds[0]) || BOOKINGS[0];
    const passengerId = (booking && booking.passenger_id) || (window.CathayPassenger && window.CathayPassenger.id) || 1;
    const bookingId = (booking && Number(booking.id)) || 1;

    const groups = state.groups.map(groupName => {
        const grp = CATHAY.groups.find(g => g.name === groupName);
        const tagCode = state.tags[groupName];
        const tagRow = (grp && tagCode)
            ? CATHAY.tags.find(t => t.group_id === grp.group_id && (t.name === tagCode || t.code === tagCode))
            : null;
        return {
            group_id: grp ? grp.group_id : null,
            tag_id: tagRow ? tagRow.tag_id : null
        };
    }).filter(g => g.group_id != null);

    const answers = [];
    for (const [key, val] of Object.entries(state.decisions)) {
        if (val !== "yes" && val !== "no") continue;
        const sId = SERVICE_ID[key];
        const aId = AIRPORT_SERVICE_ID[key];
        if (sId) {
            answers.push({ service_id: sId, answer: val });
        } else if (aId) {
            answers.push({ airport_service_id: aId, answer: val });
        } else {
            const needRow = CATHAY.needs.find(n =>
                (key === "sign" && n.service_name === "Sign language") ||
                (key === "text" && n.service_name === "Text reminders")
            );
            if (needRow) {
                answers.push({ need_id: needRow.need_id, answer: val });
            }
        }
    }

    const conditions = [];
    const groupIds = new Set(groups.map(g => g.group_id));
    (CATHAY.rule_links || []).forEach(link => {
        if (groupIds.has(link.group_id) && link.show_when && !conditions.includes(link.show_when)) {
            conditions.push(link.show_when);
        }
    });

    try {
        await fetch("/api/survey-submission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                passenger_id: passengerId,
                groups: groups,
                answers: answers,
                conditions: conditions
            })
        });

        const SSR_MAP = { Blind: "BLND", Deaf: "DEAF" };
        const codes = [];
        Object.values(state.tags || {}).forEach(t => {
            const mapped = SSR_MAP[t] || t;
            if (mapped && !codes.includes(mapped)) codes.push(mapped);
        });

        if (codes.length > 0) {
            await fetch("/api/passenger-codes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    passenger_id: passengerId,
                    booking_id: bookingId,
                    codes: codes
                })
            });
        }
    } catch (err) {
        console.error("Failed to submit questionnaire to server:", err);
    }
}

function done() {
    const hasServices = Object.values(state.decisions).some(value => value === "yes");
    title(hasServices ? "Requested Services" : "Review Your Needs");
    lead(hasServices
        ? "Please confirm if these are your selected services."
        : "No additional assistance services were selected for this trip. You can still submit your profile so our staff are aware of your needs.");
    if (hasServices) {
        const list = document.createElement("div");
        list.innerHTML = requestedHtml();
        scrollEl.appendChild(list.firstElementChild || list);
    }
    const submit = primary("Submit");
    submit.onclick = async () => {
        submit.disabled = true;
        submit.textContent = "Submitting...";
        await submitQuestionnaire();
        remember();
        state.mode = "recorded";
        render();
    };
    placeFooter(submit);
}
function recorded() {
    scrollEl.classList.add("success-scroll");
    const hasServices = Object.values(state.decisions).some(value => value === "yes");
    const booking = BOOKINGS.find(b => b.id === state.bookingIds[0]) || BOOKINGS[0];
    const passengerId = (booking && booking.passenger_id) || (window.CathayPassenger && window.CathayPassenger.id) || 1;
    const card = document.createElement("div");
    card.className = "success";
    const secondLine = hasServices
        ? "In the meantime, check out the tasks you still need to complete based on the requested services."
        : "No extra tasks are required from you before travel, though you can still review your trip plan.";
    card.innerHTML = `
        <h1>Your submission is successful</h1>
        <p>Your needs will be recorded and forwarded to the staff.</p>
        <p>${secondLine}</p>
        <a class="btn-start-chat" href="./plan.html?passenger=${passengerId}">${hasServices ? "View tasks" : "View trip plan"}</a>
    `;
    scrollEl.appendChild(card);
    footerEl.hidden = true;
    placeFooter(null);
}

function guide() {
    const node = NODES[state.node];
    const group = state.groups[state.gi];
    pickHead(group, node.q);
    if (node.multi) return guideMulti(node, group);
    if (node.note) note(node.note);
    const btn = primary("Continue");
    btn.disabled = true;
    const chosen = choiceList(node.choices.map(c => {
        return {
            label: c.label,
            go() {
                remember();
                if (c.apply) c.apply();
                if (c.decline) [].concat(c.decline).forEach(id => no(id, currentGroup()));
                if (!c.next) { advanceGroup(); return; }
                const landed = resolve(c.next);
                if (landed) state.node = landed;
                else advanceGroup();
            }
        };
    }), () => { btn.disabled = false; });
    btn.onclick = () => {
        const item = chosen();
        if (!item) return;
        item.go();
        render();
    };
    placeFooter(btn);
}

function guideMulti(node, group) {
    plain(node.note || "Select any that would help. You can choose more than one.");
    const picks = new Set();
    const list = document.createElement("div");
    list.className = "choice-list";
    node.items.forEach(item => {
        if (state.decisions[item.id] === "no") return;
        const prior = state.decisions[item.id] === "yes";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice" + (prior ? " on" : "");
        const extra = prior ? `<div class="next">Already selected</div>` : "";
        b.innerHTML = `<div class="name">${linked(item.id, item.label)}</div><div class="desc">${SERVICES[item.id][1]}</div>${extra}`;
        keepLinks(b);
        if (!prior) {
            b.onclick = () => {
                if (picks.has(item.id)) picks.delete(item.id); else picks.add(item.id);
                b.classList.toggle("on");
            };
        }
        list.appendChild(b);
    });
    scrollEl.appendChild(list);
    const btn = primary("Continue");
    btn.onclick = () => {
        remember();
        node.items.forEach(item => {
            if (state.decisions[item.id]) return;
            if (picks.has(item.id)) yes(item.id, group);
            else no(item.id, group);
        });
        if (!node.next) { advanceGroup(); render(); return; }
        const landed = resolve(node.next);
        if (landed) state.node = landed;
        else advanceGroup();
        render();
    };
    placeFooter(btn);
}

function yes(id, group) {
    if (state.decisions[id]) return;
    state.decisions[id] = "yes";
    state.chosenBy[id] = group;
}
function no(id, group) {
    if (state.decisions[id]) return;
    state.decisions[id] = "no";
    state.chosenBy[id] = group;
}
function resolve(id) {
    let guard = 0;
    while (id && NODES[id] && NODES[id].skip && NODES[id].skip() && guard++ < 30) id = NODES[id].skipNext || null;
    return id;
}
function currentGroup() { return state.groups[state.gi]; }

const FIRST = {
    "Mobility & Physical": "mob-aisle",
    "Visual": "vis-find",
    "Hearing": "hear-pa",
    "Cognitive Support": "cog-safety",
    "Neurodivergence": "nd-safety",
    "Mental health & emotional": null,
    "Sensory sensitivity": "sen-hard",
    "Communication & Language": "com-sign",
    "Medical & Health": "med-ox"
};

const NODES = {};
function add(id, q, choices, note) { NODES[id] = { q, choices, note }; }
function addMulti(id, q, items, next) {
    NODES[id] = { q, multi: true, items, next, skip: () => items.every(item => state.decisions[item.id]), skipNext: next };
}

add("mob-aisle", "Can you walk down the aisle to your seat?", [
    { label: "No", next: "mob-help", apply() { assignTag("WCHC"); } },
    { label: "Yes", next: "mob-seat" }
]);
add("mob-seat", "Can you move from the aisle into your seat by yourself?", [
    { label: "No", next: "mob-help", apply() { assignTag("WCHC"); } },
    { label: "Yes", next: "mob-stairs" }
]);
addMulti("mob-help", "Which of these would help you?", [
    { id: "attendant", label: "An attendant to take you through the airport" },
    { id: "inflight", label: "A cabin wheelchair" },
    { id: "seat", label: "Help moving between your seat and the aisle" },
    { id: "escort", label: "Someone to walk you to the lavatory door" }
], "mob-evac");
add("mob-evac", "Can you leave the aircraft by yourself in an emergency?", [
    { label: "No", next: "mob-fast", apply() {} , end: null },
    { label: "Yes", next: "mob-fast" }
], "If you cannot, we recommend bringing your own assistant, someone who can help you in an emergency.");
NODES["mob-evac"].choices[0].apply = () => { state.log.push("Rule: own safety assistant, cannot evacuate alone"); };
add("mob-stairs", "Can you climb the boarding stairs?", [
    { label: "No", next: "mob-fast", apply() { yes("attendant", currentGroup()); assignTag("WCHS"); } },
    { label: "Yes", next: "mob-long" }
]);
add("mob-long", "Can you walk a long way through the airport?", [
    { label: "No", next: "mob-fast", apply() { yes("attendant", currentGroup()); assignTag("WCHR"); } },
    { label: "Yes", next: "mob-fast" }
]);
add("mob-fast", "Would you like to check in more quickly?", [
    { label: "Yes", next: "mob-eat", apply() { yes("fast", currentGroup()); } },
    { label: "No", next: "mob-eat" }
], "If you are leaving from Hong Kong, the counter is in Area C of the Check-in Hall. At other airports, ask our staff.");
add("mob-eat", "Would you like help preparing your meal?", [
    { label: "Yes", apply() { yes("eat", currentGroup()); } },
    { label: "No" }
], "The crew can prepare your meal, such as opening packets. If you would like help eating, we recommend bringing someone with you.");
add("mob-rest", "Would you like a place to rest at the airport?", [
    { label: "Yes", next: "mob-court", apply() { if (serviceMatches("caring")) yes("caring", currentGroup()); } },
    { label: "No", next: "mob-court" }
]);
add("mob-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("vis-find", "Can you find your way through the airport without a staff member to guide you?", [
    { label: "No", next: "vis-help", apply() { assignTag("Blind"); } },
    { label: "Yes", next: "vis-video" }
]);
addMulti("vis-help", "Which of these would help you?", [
    { id: "meet", label: "Someone to guide you to and from the aircraft" },
    { id: "brief", label: "A safety briefing just for you" },
    { id: "board", label: "Boarding before other passengers" },
    { id: "menu", label: "The crew reading the menu to you" }
], "vis-seat");
add("vis-video", "Can you follow the safety video by yourself?", [
    { label: "No", next: "vis-menu", apply() { yes("brief", currentGroup()); } },
    { label: "Yes", next: "vis-menu" }
]);
add("vis-menu", "Would you like the crew to read the menu to you?", [
    { label: "Yes", next: "vis-seat", apply() { yes("menu", currentGroup()); } },
    { label: "No", next: "vis-seat" }
]);
add("vis-seat", "Can you move to and from your seat by yourself?", [
    { label: "No", next: "vis-move" },
    { label: "Yes", next: "vis-eat" }
]);
addMulti("vis-move", "Which of these would help you?", [
    { id: "seat", label: "Help moving between your seat and the aisle" },
    { id: "escort", label: "Someone to walk you to the lavatory door" }
], "vis-eat");
add("vis-eat", "Would you like help preparing your meal?", [
    { label: "Yes", next: "vis-cane", apply() { yes("eat", currentGroup()); } },
    { label: "No", next: "vis-cane" }
], "The crew can prepare your meal, such as opening packets. If you would like help eating, we recommend bringing someone with you.");
add("vis-cane", "Do you use a cane?", [
    { label: "Yes", next: "vis-dog", apply() { yes("cane", currentGroup()); } },
    { label: "No", next: "vis-dog" }
]);
add("vis-dog", "Will a guide dog travel with you?", [
    { label: "Yes", apply() { yes("dog", currentGroup()); } },
    { label: "No" }
]);
add("vis-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("hear-pa", "Can you hear the announcements?", [
    { label: "No", next: "hear-help", apply() { assignTag("Deaf"); } },
    { label: "Yes", next: "hear-sound" }
]);
add("hear-sound", "Can you follow the safety briefing by listening to it?", [
    { label: "No", next: "hear-help", apply() { assignTag("Deaf"); } },
    { label: "Yes", next: "hear-aid" }
]);
addMulti("hear-help", "Which of these would help you?", [
    { id: "meet", label: "Someone to guide you to and from the aircraft" },
    { id: "brief", label: "A safety briefing just for you" },
    { id: "board", label: "Boarding before other passengers" }
], "hear-aid");
add("hear-aid", "Do you use a hearing aid or headset?", [
    { label: "Yes", next: "hear-tx", apply() { yes("aidsHear", currentGroup()); } },
    { label: "No", next: "hear-tx" }
]);
add("hear-tx", "Will you bring a device that sends sound to your hearing aid?", [
    { label: "Yes", next: "hear-speak", apply() { yes("transmit", currentGroup()); } },
    { label: "No", next: "hear-speak" }
]);
add("hear-speak", "Would you like help at check-in or boarding?", [
    { label: "Yes", next: "hear-dog", apply() { yes("checkin", currentGroup()); } },
    { label: "No", next: "hear-dog" }
]);
add("hear-dog", "Will an assistance dog travel with you?", [
    { label: "Yes", next: "hear-both", apply() { yes("dog", currentGroup()); } },
    { label: "No", next: "hear-both" }
]);
add("hear-both", "Do you also have serious difficulty seeing?", [
    { label: "Yes", apply() { state.log.push("Rule: own safety assistant, severe vision and hearing loss together"); } },
    { label: "No" }
], "If you do, we recommend bringing your own assistant, someone who can help you in an emergency.");
add("hear-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("cog-safety", "Can you follow the safety instructions by yourself?", [
    { label: "No", apply() { state.safety = "no"; state.log.push("Rules: own safety assistant, and crew cannot attend continuously"); } },
    { label: "Yes", next: "cog-whole", apply() { state.safety = "yes"; } }
], "If you cannot, we recommend bringing your own assistant, someone who can help you in an emergency and stay with you during the flight.");
add("cog-whole", "Will someone be with you for the whole flight?", [
    { label: "Yes", apply() { state.log.push("Rule: crew cannot attend continuously"); } },
    { label: "No" }
], "If you would like someone with you for the whole flight, we recommend bringing them with you.");
add("cog-flower", "Would you like a free Sunflower lanyard, so staff know you may need more time?", [
    { label: "Yes", next: "cog-court", apply() { const key = earliestSunflowerKey(); if (key) yes(key, currentGroup()); } },
    { label: "No", next: "cog-court" }
]);
add("cog-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("nd-safety", "Can you follow the safety instructions by yourself?", [
    { label: "No", apply() { state.safety = "no"; state.log.push("Rule: own safety assistant"); } },
    { label: "Yes", apply() { state.safety = "yes"; } }
], "If you cannot, we recommend bringing your own assistant, someone who can help you in an emergency.");
add("nd-quiet", "Would you like a quiet place to rest before boarding?", [
    { label: "Yes", next: "nd-flower", apply() { if (serviceMatches("corner")) yes("corner", currentGroup()); } },
    { label: "No", next: "nd-flower" }
]);
add("nd-flower", "Would you like a free Sunflower lanyard, so staff know you may need more time?", [
    { label: "Yes", next: "nd-court", apply() { const key = earliestSunflowerKey(); if (key) yes(key, currentGroup()); } },
    { label: "No", next: "nd-court" }
]);
add("nd-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("mh-flower", "Would you like a free Sunflower lanyard, so staff know you may need more time?", [
    { label: "Yes", next: "mh-court", apply() { const key = earliestSunflowerKey(); if (key) yes(key, currentGroup()); } },
    { label: "No", next: "mh-court" }
]);
add("mh-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("sen-hard", "Do noise, light, or crowds make most of your journey difficult?", [
    { label: "Yes" },
    { label: "No", next: "sen-seat" }
]);
add("sen-seat", "Would a quieter seat help?", [
    { label: "Yes", apply() { yes("seating", currentGroup()); } },
    { label: "No" }
]);
add("sen-quiet", "Would you like a quiet place to rest before boarding?", [
    { label: "Yes", next: "sen-flower", apply() { if (serviceMatches("corner")) yes("corner", currentGroup()); } },
    { label: "No", next: "sen-flower" }
]);
add("sen-flower", "Would you like a free Sunflower lanyard, so staff know you may need more time?", [
    { label: "Yes", next: "sen-court", apply() { const key = earliestSunflowerKey(); if (key) yes(key, currentGroup()); } },
    { label: "No", next: "sen-court" }
]);
add("sen-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("com-sign", "Do you communicate in sign language?", [
    { label: "Yes", next: "com-text", apply() { yes("sign", currentGroup()); } },
    { label: "No", next: "com-text" }
], "Staff can use sign language with you at the airport and on the flight.");
add("com-text", "Would you like digital notifications for announcements?", [
    { label: "Yes", next: "com-help", apply() { yes("text", currentGroup()); } },
    { label: "No", next: "com-help" }
], "We will send a digital notification when there is an announcement.");
addMulti("com-help", "Which of these would help you?", [
    { id: "meet", label: "Someone to guide you to and from the aircraft" },
    { id: "brief", label: "A safety briefing just for you" },
    { id: "board", label: "Boarding before other passengers" },
    { id: "checkin", label: "Help at check-in and when you board" }
], null);
add("com-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No" }
]);

add("med-ox", "Do you need medical oxygen on the flight?", [
    { label: "Yes", next: "med-poc", apply() { yes("oxygen", currentGroup()); } },
    { label: "No", next: "med-poc" }
]);
add("med-poc", "Are you bringing your own portable oxygen machine (a portable oxygen concentrator)?", [
    { label: "Yes", next: "med-stretch", apply() { yes("poc", currentGroup()); } },
    { label: "No", next: "med-stretch" }
]);
add("med-stretch", "Do you need a stretcher?", [
    { label: "Yes", next: "med-attn", apply() { yes("stretcher", currentGroup()); state.log.push("Rule: own safety assistant. Passenger pays escort, ambulance, and hospital."); } },
    { label: "No", next: "med-attn" }
], "An additional fee applies for the stretcher. We recommend bringing your own assistant, someone who can help you in an emergency. Their ticket, the ambulance, and hospital care would be at your cost.");
add("med-attn", "Will you need medical attention during the flight?", [
    { label: "Yes", next: "med-dev", apply() { state.log.push("Rule: own safety assistant, regular medical attention"); } },
    { label: "No", next: "med-dev" }
], "If you do, we recommend bringing your own assistant, someone who can help you during the flight.");
add("med-dev", "Are you bringing your own medical device?", [
    { label: "Yes", next: "med-cpap", apply() { yes("med", currentGroup()); } },
    { label: "No", next: "med-cpap" }
]);
add("med-cpap", "Are you bringing a continuous positive airway pressure (CPAP) or bi-level positive airway pressure (BIPAP) machine?", [
    { label: "Yes", next: "med-meds", apply() { yes("cpap", currentGroup()); } },
    { label: "No", next: "med-meds" }
]);
add("med-meds", "Are you carrying medicine or needles, such as for injections?", [
    { label: "Yes", next: "med-card", apply() { state.log.push("Rule: medication and needles"); } },
    { label: "No", next: "med-card" }
]);
add("med-card", "Would you like a Frequent Traveller's Medical Card (FREMEC), so we already have the details of a condition that is not changing?", [
    { label: "Yes", apply() { yes("fremec", currentGroup()); } },
    { label: "No" }
]);
add("med-court", "Would you like to go through security and immigration more quickly?", [
    { label: "Yes", apply() { if (serviceMatches("courtesy")) yes("courtesy", currentGroup()); } },
    { label: "No", decline: "courtesy" }
]);

function markSkip(id, when, next) {
    NODES[id].skip = when;
    NODES[id].skipNext = next;
}
function decline(nodeId, label, ids) {
    const choice = NODES[nodeId].choices.find(c => c.label === label);
    choice.decline = ids;
}
markSkip("mob-fast", () => true, "mob-eat");
markSkip("mob-eat", () => !!state.decisions.eat, null);
decline("mob-eat", "No", "eat");
markSkip("vis-seat", () => state.decisions.seat && state.decisions.escort, "vis-eat");
markSkip("vis-eat", () => !!state.decisions.eat, "vis-cane");
markSkip("vis-cane", () => !!state.decisions.cane, "vis-dog");
markSkip("vis-dog", () => !!state.decisions.dog, null);
decline("vis-video", "Yes", "brief");
decline("vis-menu", "No", "menu");
decline("vis-seat", "Yes", ["seat", "escort"]);
decline("vis-eat", "No", "eat");
decline("vis-cane", "No", "cane");
decline("vis-dog", "No", "dog");
markSkip("hear-aid", () => !!state.decisions.aidsHear, "hear-tx");
markSkip("hear-tx", () => !!state.decisions.transmit, "hear-speak");
markSkip("hear-speak", () => !!state.decisions.checkin, "hear-dog");
markSkip("hear-dog", () => !!state.decisions.dog, "hear-both");
decline("hear-aid", "No", "aidsHear");
decline("hear-tx", "No", "transmit");
decline("hear-speak", "No", "checkin");
decline("hear-dog", "No", "dog");
markSkip("cog-safety", () => !!state.safety, null);
markSkip("nd-safety", () => !!state.safety, null);
markSkip("sen-seat", () => !!state.decisions.seating, null);
decline("sen-seat", "No", "seating");
markSkip("com-sign", () => !!state.decisions.sign, "com-text");
markSkip("com-text", () => !!state.decisions.text, "com-help");
decline("com-sign", "No", "sign");
decline("com-text", "No", "text");
["med-ox", "med-poc", "med-stretch", "med-dev", "med-cpap", "med-card"].forEach((id, i) => {
    const key = ["oxygen", "poc", "stretcher", "med", "cpap", "fremec"][i];
    const next = ["med-poc", "med-stretch", "med-attn", "med-cpap", "med-meds", null][i];
    markSkip(id, () => !!state.decisions[key], next);
    decline(id, "No", key);
});
function clearProgress() {
    state.bookingIds = [];
    state.groups = [];
    state.gi = 0;
    state.node = null;
    state.decisions = {};
    state.chosenBy = {};
    state.tag = "";
    state.tags = {};
    state.follow = null;
    state.safety = "";
    state.log = [];
    state.history = [];
    state.draft = [];
    state.draftGroup = null;
}
function reset() {
    clearProgress();
    state.mode = "notice";
    render();
}
function inQuestionnaire() {
    return state.mode !== "notice" && state.mode !== "chat";
}
function returnToConversation() {
    clearProgress();
    window.location.assign("./index.html?view=chat");
}

const resetBtn = document.getElementById("btn-reset");
if (resetBtn) resetBtn.onclick = reset;
document.getElementById("btn-start-questionnaire").onclick = () => {
    state.mode = "bookings";
    render();
};
document.getElementById("btn-close").onclick = () => {
    if (state.mode === "recorded" || state.mode === "notice" || !inQuestionnaire()) {
        returnToConversation();
        return;
    }
    document.getElementById("exit-dialog").classList.remove("hidden");
    document.getElementById("exit-no").focus();
};
document.getElementById("exit-no").onclick = () => {
    document.getElementById("exit-dialog").classList.add("hidden");
};
document.getElementById("exit-yes").onclick = returnToConversation;
document.getElementById("exit-dialog").onclick = (event) => {
    if (event.target.id === "exit-dialog") document.getElementById("exit-dialog").classList.add("hidden");
};
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("exit-dialog").classList.contains("hidden")) {
        document.getElementById("exit-dialog").classList.add("hidden");
    }
});
document.getElementById("chat-form").onsubmit = (event) => {
    event.preventDefault();
    const input = document.getElementById("chat-user-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    postChat("user", text);
    postChat("assistant", "I can help with flights, baggage, and membership.");
};
document.querySelectorAll(".option-chip").forEach(chip => {
    chip.onclick = () => {
        const text = chip.getAttribute("data-prompt") || chip.textContent.trim();
        postChat("user", text);
        postChat("assistant", "I can help with flights, baggage, and membership.");
    };
});
function postChat(role, text) {
    const box = document.getElementById("chat-messages-container");
    if (role === "assistant") {
        const meta = document.createElement("div");
        meta.className = "message-meta";
        meta.dataset.added = "1";
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toLowerCase();
        meta.textContent = `CARE ${time}`;
        box.appendChild(meta);
    }
    const bubble = document.createElement("div");
    bubble.className = role === "user" ? "chat-bubble-sent" : "chat-bubble-received";
    bubble.dataset.added = "1";
    bubble.textContent = text;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
}
render();
