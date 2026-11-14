/* Form for a trip-plan task that asks the passenger for an answer. The answer is saved in the database. */

const params = new URLSearchParams(window.location.search);
const passengerId = window.CathayPassenger.id;
const taskKey = params.get("key") || "";
const stage = params.get("stage") || "before travel";
const backHref = `./plan.html?passenger=${passengerId}&stage=${encodeURIComponent(stage)}`;
const root = document.getElementById("task-form");
const closeForm = document.getElementById("close-form");

closeForm.href = backHref;

function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
}

function tripView() {
    return buildPlan(passengerId);
}

function findTask(view) {
    return view.stages.flatMap((row) => row.items).find((item) => item.key === taskKey) || null;
}

function departureMoment(departsAt) {
    return new Date(String(departsAt).replace(" ", "T") + "+08:00");
}

function arrivalMoment(departsAt, hhmm) {
    const departs = departureMoment(departsAt);
    const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(departs);
    return new Date(`${day}T${hhmm}:00+08:00`);
}

function latestArrival(departsAt) {
    return new Date(departureMoment(departsAt).getTime() - 2 * 3600000);
}

function clockLabel(date) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(date);
}

function showMessage(text) {
    root.innerHTML = `<p class="meta">${escapeText(text)}</p><p class="meta"><a href="${backHref}">Back to the trip plan</a></p>`;
}

function questionsFor(item) {
    if (item.questions && item.questions.length) return item.questions;
    if (!item.reply || item.reply === "form") return [];
    return [{ key: item.key, reply: item.reply, what: item.what }];
}

function fieldHtml(question, index, booking) {
    const prompt = question.what ? `<p class="prompt">${escapeText(question.what)}</p>` : "";
    if (question.reply === "time") {
        const latest = booking ? clockLabel(latestArrival(booking.departs_at)) : "";
        return `<fieldset class="question">${prompt}<label class="time-label" for="answer-${index}">Time</label><input id="answer-${index}" name="time-${index}" type="time" required><p class="limit">The latest time for this flight is ${escapeText(latest)}.</p></fieldset>`;
    }
    return `<fieldset class="question">${prompt}<div class="choices" role="radiogroup">
        <label class="choice"><input type="radio" name="yesno-${index}" value="yes" required> Yes</label>
        <label class="choice"><input type="radio" name="yesno-${index}" value="no"> No</label>
    </div></fieldset>`;
}

function formHtml(item, booking) {
    const questions = questionsFor(item);
    const intro = questions.length > 1 && item.what ? `<p class="prompt">${escapeText(item.what)}</p>` : "";
    const fields = questions.map((question, index) => fieldHtml(question, index, booking)).join("");
    return `<form class="task-form">
        <h2>${escapeText(item.service)}</h2>
        ${intro}
        ${fields}
        <p class="form-error" hidden></p>
        <button class="save" type="submit">Save</button>
    </form>`;
}

function readAnswer(form, question, index) {
    if (question.reply === "time") return String(form.querySelector(`[name="time-${index}"]`).value).slice(0, 5);
    const chosen = form.querySelector(`input[name="yesno-${index}"]:checked`);
    return chosen ? chosen.value : "";
}

function fillAnswer(form, question, index, answer) {
    if (!answer) return;
    if (question.reply === "time") {
        form.querySelector(`[name="time-${index}"]`).value = answer;
        return;
    }
    const chosen = form.querySelector(`input[name="yesno-${index}"][value="${answer}"]`);
    if (chosen) chosen.checked = true;
}

async function loadAnswer(form, questions) {
    const response = await fetch(`/api/task-replies?passenger_id=${passengerId}`);
    if (!response.ok) throw new Error("The saved answer could not be loaded.");
    const body = await response.json();
    questions.forEach((question, index) => {
        const row = (body.replies || []).find((entry) => entry.task_key === question.key);
        if (row) fillAnswer(form, question, index, row.answer);
    });
}

async function saveAnswer(item, answer) {
    const response = await fetch("/api/task-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            passenger_id: passengerId,
            task_key: item.key,
            reply: item.reply,
            answer,
        }),
    });
    if (response.ok) return;
    let detail = "The answer could not be saved.";
    try {
        const body = await response.json();
        if (body.detail) detail = typeof body.detail === "string" ? body.detail : detail;
    } catch (error) {
        detail = "The answer could not be saved.";
    }
    throw new Error(detail);
}

function openForm(item, booking) {
    const questions = questionsFor(item);
    root.innerHTML = formHtml(item, booking);
    const form = root.querySelector("form");
    const error = form.querySelector(".form-error");
    loadAnswer(form, questions).catch((loadError) => {
        error.hidden = false;
        error.textContent = loadError.message;
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.hidden = true;
        const answers = questions.map((question, index) => ({
            question,
            answer: readAnswer(form, question, index),
        }));
        const timing = answers.find((entry) => entry.question.reply === "time");
        if (timing && booking && arrivalMoment(booking.departs_at, timing.answer) > latestArrival(booking.departs_at)) {
            error.hidden = false;
            error.textContent = `Arrive at least 2 hours before departure. The latest time is ${clockLabel(latestArrival(booking.departs_at))}.`;
            return;
        }
        try {
            for (const entry of answers) {
                await saveAnswer({ key: entry.question.key, reply: entry.question.reply }, entry.answer);
            }
            window.location.assign(backHref);
        } catch (saveError) {
            error.hidden = false;
            error.textContent = saveError.message;
        }
    });
}

try {
    const view = tripView();
    const task = findTask(view);
    if (!task || !questionsFor(task).length) showMessage("This task does not ask for more information.");
    else openForm(task, view.booking);
} catch (error) {
    console.error("Task could not be displayed.", error);
    showMessage(error.message);
}
