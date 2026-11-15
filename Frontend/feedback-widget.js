(() => {
    const CATEGORIES = [
        "Other",
        "Mobility",
        "Visual",
        "Hearing",
        "Cognitive",
        "Neurodivergence",
        "Sensory",
        "Communication",
        "Medical",
    ];

    function detectSourcePage() {
        const path = window.location.pathname.toLowerCase();
        if (path.includes("questionnaire")) return "questionnaire";
        if (path.includes("plan")) return "plan";
        if (path.includes("task-form")) return "task-form";
        return "chat";
    }

    function activePassengerId() {
        const raw = sessionStorage.getItem("vera-passenger-id");
        if (raw && /^[1-4]$/.test(raw)) return Number(raw);
        if (window.CathayPassenger && window.CathayPassenger.id) {
            return Number(window.CathayPassenger.id);
        }
        return 1;
    }

    function initFeedbackWidget() {
        const headerActions = document.querySelector(".header-actions");
        const phoneShell = document.querySelector(".chat-modal, .phone");
        if (!headerActions || !phoneShell || document.getElementById("btn-open-feedback")) return;

        const feedbackBtn = document.createElement("button");
        feedbackBtn.type = "button";
        feedbackBtn.id = "btn-open-feedback";
        feedbackBtn.className = "icon-btn";
        feedbackBtn.title = "Suggest accessibility service";
        feedbackBtn.setAttribute("aria-label", "Suggest accessibility service");
        feedbackBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="10" y1="10" x2="14" y2="10"/></svg>`;
        headerActions.insertBefore(feedbackBtn, headerActions.firstChild);

        const modal = document.createElement("div");
        modal.id = "feedback-modal";
        modal.className = "phone-modal-backdrop hidden";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "feedback-modal-title");
        modal.innerHTML = `
            <div class="phone-modal-card feedback-modal-card">
                <h2 id="feedback-modal-title">Suggest an Accessibility Service</h2>
                <p class="feedback-modal-subtitle">Tell us what additional accessibility service you would prefer for your trip.</p>
                <form id="feedback-form" class="feedback-form">
                    <label class="feedback-field">
                        <span>Preferred service</span>
                        <input type="text" id="feedback-service-input" maxlength="200" required placeholder="e.g., Quiet boarding lounge or live captions">
                    </label>
                    <label class="feedback-field">
                        <span>Category</span>
                        <select id="feedback-category-select">
                            ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
                        </select>
                    </label>
                    <label class="feedback-field">
                        <span>Additional details (optional)</span>
                        <textarea id="feedback-details-input" rows="3" maxlength="500" placeholder="Share how this service would help you"></textarea>
                    </label>
                    <p id="feedback-status" class="feedback-status hidden" role="status"></p>
                    <div class="phone-modal-actions">
                        <button type="submit" id="feedback-submit-btn" class="btn-start-chat">Submit preference</button>
                        <button type="button" id="feedback-cancel-btn" class="btn-cancel-prompt">Cancel</button>
                    </div>
                </form>
            </div>
        `;
        phoneShell.appendChild(modal);

        if (!document.getElementById("staff-insights-footer-link")) {
            const staffLink = document.createElement("a");
            staffLink.id = "staff-insights-footer-link";
            staffLink.className = "staff-insights-footer-link";
            staffLink.href = "./feedback-insights.html";
            staffLink.target = "_blank";
            staffLink.rel = "noopener noreferrer";
            staffLink.textContent = "View staff insights";
            document.body.appendChild(staffLink);
        }

        const form = modal.querySelector("#feedback-form");
        const serviceInput = modal.querySelector("#feedback-service-input");
        const categorySelect = modal.querySelector("#feedback-category-select");
        const detailsInput = modal.querySelector("#feedback-details-input");
        const statusEl = modal.querySelector("#feedback-status");
        const submitBtn = modal.querySelector("#feedback-submit-btn");
        const cancelBtn = modal.querySelector("#feedback-cancel-btn");

        function openModal() {
            statusEl.className = "feedback-status hidden";
            statusEl.textContent = "";
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit preference";
            modal.classList.remove("hidden");
            serviceInput.focus();
        }

        function closeModal() {
            modal.classList.add("hidden");
        }

        feedbackBtn.addEventListener("click", openModal);
        cancelBtn.addEventListener("click", closeModal);
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal();
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const preferredService = serviceInput.value.trim();
            if (!preferredService) {
                statusEl.className = "feedback-status error";
                statusEl.textContent = "Please enter an accessibility service preference.";
                serviceInput.focus();
                return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = "Submitting...";
            statusEl.className = "feedback-status hidden";
            try {
                const response = await fetch("/api/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        passenger_id: activePassengerId(),
                        category: categorySelect.value,
                        preferred_service: preferredService,
                        details: detailsInput.value.trim(),
                        source_page: detectSourcePage(),
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.detail || "Could not save your preference.");
                }
                form.reset();
                statusEl.className = "feedback-status success";
                statusEl.textContent = "Thank you! Your preference has been recorded.";
                submitBtn.disabled = false;
                submitBtn.textContent = "Submit another";
            } catch (error) {
                statusEl.className = "feedback-status error";
                statusEl.textContent = error.message || "Could not save your preference.";
                submitBtn.disabled = false;
                submitBtn.textContent = "Submit preference";
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initFeedbackWidget);
    } else {
        initFeedbackWidget();
    }
})();
