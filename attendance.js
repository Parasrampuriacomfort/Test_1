const API_URL = "https://script.google.com/macros/s/AKfycbyke_kVVkFvk-gLHZUKKHaicgJY2sJ0_ppbgq8kv7b1DK7xpTnYjQVF-Q7CD--5oTmk/exec";

// Cache DOM elements to prevent repeated slow lookups on old phones
const els = {
    checkinBtn: document.getElementById("checkinButton"),
    checkoutBtn: document.getElementById("checkoutButton"),
    locPopup: document.getElementById("locationPopup"),
    locPopupText: document.getElementById("locationPopupText"),
    loadOverlay: document.getElementById("loadingOverlay"),
    loadTitle: document.getElementById("loadingTitle")
};

let attendanceAction = "";

if (els.checkinBtn) els.checkinBtn.addEventListener("click", () => checkIn());
if (els.checkoutBtn) els.checkoutBtn.addEventListener("click", () => checkOut());

function showLocationPopup(message) {
    els.locPopupText.innerText = message;
    els.locPopup.classList.remove("hidden");
}

function closeLocationPopup() {
    els.locPopup.classList.add("hidden");
}

async function enableLocation() {
    closeLocationPopup();
    navigator.geolocation.getCurrentPosition(
        async function() {
            if (attendanceAction === "checkin") await checkIn();
            else if (attendanceAction === "checkout") await checkOut();
        },
        function() { alert("Please enable Location in your phone settings."); },
        { enableHighAccuracy: true }
    );
}

function showLoading(title) {
    els.loadTitle.innerText = title;
    els.loadOverlay.classList.remove("hidden");
}

function hideLoading() {
    els.loadOverlay.classList.add("hidden");
}

function getCurrentTime() {
    const now = new Date();
    return {
        date: now.toISOString().split("T")[0],
        time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    };
}

async function checkIn() {
    attendanceAction = "checkin";
    els.checkinBtn.disabled = true;
    showLoading("Checking In...");

    try {
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        const dt = getCurrentTime();
        
        const employeeEmail = localStorage.getItem("email");
        const recordId = employeeEmail + "_" + dt.date.replaceAll("-", "");

        const data = {
            action: "checkin",
            recordId,
            employeeName: localStorage.getItem("name"),
            employeeEmail,
            date: dt.date,
            checkIn: dt.time,
            checkInLocation: address
        };

        await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
        window.location.reload(); // Reload handles fresh UI mapping
    } catch (error) {
        console.error(error);
    } finally {
        hideLoading();
        els.checkinBtn.disabled = false;
    }
}

async function checkOut() {
    attendanceAction = "checkout";
    els.checkoutBtn.disabled = true;
    showLoading("Checking Out...");

    try {
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        const dt = getCurrentTime();
        
        const employeeEmail = localStorage.getItem("email");
        const recordId = employeeEmail + "_" + dt.date.replaceAll("-", "");

        const data = {
            action: "checkout",
            recordId,
            checkOut: dt.time,
            checkOutLocation: address
        };

        await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
        window.location.reload();
    } catch (error) {
        console.error(error);
    } finally {
        hideLoading();
        els.checkoutBtn.disabled = false;
    }
}

async function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject("Geolocation is not supported.");
        
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            (error) => {
                if (error.code === error.PERMISSION_DENIED) showLocationPopup("Location permission is required to mark attendance.");
                else if (error.code === error.POSITION_UNAVAILABLE) showLocationPopup("Location is turned OFF. Please enable GPS.");
                else if (error.code === error.TIMEOUT) showLocationPopup("Unable to get your location.");
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

async function getAddress(latitude, longitude) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
        const data = await response.json();
        const a = data.address;
        return `${a.suburb || ""}, ${a.city || a.town || ""}, ${a.state || ""}`.replace(/^, /, '');
    } catch (e) {
        return "Location unknown";
    }
}
