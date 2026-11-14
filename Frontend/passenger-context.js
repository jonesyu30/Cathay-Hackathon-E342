(() => {
    const storageKey = "vera-passenger-id";
    const isPassengerId = (value) => /^[1-4]$/.test(value || "");
    const queryPassengerId = new URLSearchParams(window.location.search).get("passenger");

    if (isPassengerId(queryPassengerId)) {
        sessionStorage.setItem(storageKey, queryPassengerId);
    }

    let passengerId = sessionStorage.getItem(storageKey);
    if (!isPassengerId(passengerId)) {
        passengerId = "1";
        sessionStorage.setItem(storageKey, passengerId);
    }

    window.CathayPassenger = Object.freeze({ id: Number(passengerId) });
})();
