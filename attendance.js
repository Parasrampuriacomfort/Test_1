const API_URL = "https://script.google.com/macros/s/AKfycbya3Rq7zL3zTWCDaF5T1OCKz0BrsA2IPLB3mz826_ngcgowRgHY_rVkaS8YZDwvBNcA/exec";
const API_URL_GET = "https://script.google.com/macros/s/AKfycbya3Rq7zL3zTWCDaF5T1OCKz0BrsA2IPLB3mz826_ngcgowRgHY_rVkaS8YZDwvBNcA/exec";

const checkinButton = document.getElementById("checkinButton");
const checkoutButton = document.getElementById("checkoutButton");

let attendanceAction = "";
window.currentDbCheckInDate = null; 

// --- BUTTON EVENT LISTENERS ---
if (checkinButton) {
    checkinButton.addEventListener("click", () => {
        checkIn();
    });
}

if (checkoutButton) {
    checkoutButton.addEventListener("click", () => {
        checkOut();
    });
}

// --- UI BUTTON CONTROLLER ---
function setButtonStates(canCheckIn, canCheckOut) {
    const cinBtn = document.getElementById("checkinButton");
    const coutBtn = document.getElementById("checkoutButton");
    
    const activeClass = "interactive-btn bg-black text-white py-4 px-6 rounded-lg flex flex-col items-center justify-center gap-2 h-32 shadow-lg w-full transition-all";
    const disabledClass = "interactive-btn bg-surface-container-high text-secondary py-4 px-6 rounded-lg flex flex-col items-center justify-center gap-2 h-32 cursor-not-allowed opacity-60 w-full transition-all";

    if (cinBtn) {
        cinBtn.disabled = !canCheckIn;
        cinBtn.className = canCheckIn ? activeClass : disabledClass;
        // Reset HTML in case it was stuck in locating state
        cinBtn.innerHTML = `<span class="material-symbols-outlined text-[32px]" style="font-variation-settings: 'FILL' 1;">login</span><span class="font-headline-sm text-headline-sm">Check In</span>`;
    }
    
    if (coutBtn) {
        coutBtn.disabled = !canCheckOut;
        coutBtn.className = canCheckOut ? activeClass : disabledClass;
        // Reset HTML in case it was stuck in locating state
        coutBtn.innerHTML = `<span class="material-symbols-outlined text-[32px]" style="font-variation-settings: 'FILL' 0;">logout</span><span class="font-headline-sm text-headline-sm">Check Out</span>`;
    }
}

// --- GOOGLE SHEETS TIMEZONE FIX ---
function formatSafeTime(timeValue) {
    if (!timeValue || String(timeValue).trim() === "" || String(timeValue).includes("NaN")) return "--:--";
    let str = String(timeValue).trim();
    
    if (str.includes("T")) {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            return d.toLocaleTimeString("en-US", { 
                timeZone: "America/Los_Angeles", 
                hour: "2-digit", 
                minute: "2-digit" 
            }).toLowerCase();
        }
    }
    return str;
}

// --- HELPER: CONVERT STRING TO DATE FOR MATH ---
function parseTimeStr(timeStr) {
    if (!timeStr || timeStr === "--:--") return null;
    const today = new Date();
    const match = timeStr.match(/(\d+):(\d+)\s*(am|pm)/i);
    if (match) {
        let hr = parseInt(match[1], 10);
        const min = parseInt(match[2], 10);
        const ampm = match[3].toLowerCase();
        if (ampm === 'pm' && hr !== 12) hr += 12;
        if (ampm === 'am' && hr === 12) hr = 0;
        today.setHours(hr, min, 0, 0);
        return today;
    }
    return null;
}

// --- MODALS & SMART ERROR HANDLING ---

// Icon + label rows shown inside the popup, built dynamically per situation
function buildLocationSteps(kind) {
    // kind: "permission" | "gps" | "unsupported"
    const rows = [];

    if (kind === "permission" || kind === "gps") {
        rows.push(`
            <div class="flex items-start gap-3">
                <span class="material-symbols-outlined text-indigo-300" style="font-variation-settings:'FILL' 1;">location_on</span>
                <span class="text-gray-200 text-sm pt-0.5">Device location</span>
            </div>`);
    }
    if (kind === "permission") {
        rows.push(`
            <div class="flex items-start gap-3">
                <span class="material-symbols-outlined text-indigo-300" style="font-variation-settings:'FILL' 1;">my_location</span>
                <span class="text-gray-200 text-sm pt-0.5">Site permission to access your location (currently blocked)</span>
            </div>`);
    }
    if (kind === "gps") {
        rows.push(`
            <div class="flex items-start gap-3">
                <span class="material-symbols-outlined text-indigo-300" style="font-variation-settings:'FILL' 1;">gps_off</span>
                <span class="text-gray-200 text-sm pt-0.5">GPS / Location Accuracy is turned off in your phone's quick settings</span>
            </div>`);
    }
    return rows.join("");
}

function showLocationPopup(title, message, kind = "gps") {
    const popup = document.getElementById("locationPopup");
    const popupTitle = document.getElementById("locationPopupTitle");
    const popupText = document.getElementById("locationPopupText");
    const stepsBox = document.getElementById("locationPopupSteps");
    const turnOnBtn = document.getElementById("locationPopupTurnOnBtn");

    if (popupTitle) popupTitle.textContent = title;
    if (popupText) popupText.textContent = message;
    if (stepsBox) stepsBox.innerHTML = buildLocationSteps(kind);

    // If permission is hard-blocked, the browser can't re-prompt itself —
    // "Turn on" can't do anything until the user flips it in browser settings.
    if (turnOnBtn) {
        turnOnBtn.style.display = kind === "permission" ? "none" : "inline-block";
    }

    if (popup) popup.classList.remove("hidden");
}

function closeLocationPopup() {
    const popup = document.getElementById("locationPopup");
    if (popup) popup.classList.add("hidden");
    
    // Reset buttons to normal state if they were stuck loading
    const cachedData = localStorage.getItem("attendanceCache");
    const email = localStorage.getItem("email");
    if (cachedData && email) {
        processAttendanceData(JSON.parse(cachedData), email);
    } else {
        setButtonStates(true, true); 
    }
}

// --- LIVE LOCATION STATUS BADGE ---
function setLocationBadge(state) {
    // state: "on" | "off" | "checking" | "blocked"
    const dot = document.getElementById("locationStatusDot");
    const text = document.getElementById("locationStatusText");
    if (!dot || !text) return;

    const styles = {
        checking: { dot: "bg-gray-400", label: "Checking location…" },
        on:       { dot: "bg-green-500", label: "Location enabled ✓" },
        off:      { dot: "bg-error animate-pulse", label: "Location is off — tap to enable" },
        blocked:  { dot: "bg-error animate-pulse", label: "Location permission blocked — tap to fix" },
    };
    const s = styles[state] || styles.checking;
    dot.className = `w-2 h-2 rounded-full ${s.dot}`;
    text.textContent = s.label;
}

// Runs proactively (on load + whenever the tab becomes visible again)
// so the user knows the location status BEFORE tapping Check In/Out.
async function checkLocationStatus(showPopupIfOff = false) {
    if (!navigator.geolocation) {
        setLocationBadge("off");
        if (showPopupIfOff) {
            showLocationPopup("Location Not Supported", "Your browser does not support location services.", "unsupported");
        }
        return false;
    }

    setLocationBadge("checking");

    // 1. Check permission state if the browser supports it
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const status = await navigator.permissions.query({ name: "geolocation" });

            // Keep the badge live if the user changes permission mid-session
            status.onchange = () => checkLocationStatus(false);

            if (status.state === "denied") {
                setLocationBadge("blocked");
                if (showPopupIfOff) {
                    showLocationPopup(
                        "Location Permission Blocked",
                        "Tap the lock icon 🔒 in your browser's address bar → Permissions → Location → Allow, then reload the page.",
                        "permission"
                    );
                }
                return false;
            }
        } catch (e) {
            // Permissions API not fully supported (e.g. older iOS Safari) — fall through to direct check
        }
    }

    // 2. Actually attempt a (low accuracy, cheap) location read.
    // This is what catches "permission granted but device GPS/location toggle is off".
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            () => {
                setLocationBadge("on");
                resolve(true);
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    setLocationBadge("blocked");
                    if (showPopupIfOff) {
                        showLocationPopup(
                            "Location Permission Blocked",
                            "Tap the lock icon 🔒 in your browser's address bar → Permissions → Location → Allow, then reload the page.",
                            "permission"
                        );
                    }
                } else {
                    // POSITION_UNAVAILABLE or TIMEOUT ~= device location/GPS is off
                    setLocationBadge("off");
                    if (showPopupIfOff) {
                        showLocationPopup(
                            "Turn On Device Location",
                            "Swipe down and enable Location/GPS on your phone, then try again.",
                            "gps"
                        );
                    }
                }
                resolve(false);
            },
            { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
        );
    });
}

// Tapping the badge itself re-checks and shows the popup immediately if off
document.addEventListener("DOMContentLoaded", () => {
    const badge = document.getElementById("locationStatusBadge");
    if (badge) badge.addEventListener("click", () => checkLocationStatus(true));
});

// Re-check whenever the user comes back to the tab/app (they may have just
// flipped the GPS toggle in quick settings and returned)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkLocationStatus(false);
});

async function enableLocation() {
    closeLocationPopup();
    
    // Trigger action again to fire native browser prompt if available
    if (attendanceAction === "checkin") {
        await checkIn();
    } else if (attendanceAction === "checkout") {
        await checkOut();
    }
}

// --- FAST LOCATION FETCHING ---
async function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            showLocationPopup("Not Supported", "Your browser does not support location services.", "unsupported");
            return reject("Geolocation is not supported.");
        }
        
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
            (error) => {
                // Smart Error Handling
                if (error.code === error.PERMISSION_DENIED) {
                    showLocationPopup(
                        "Permission Denied", 
                        "You blocked location access. Please tap the lock icon 🔒 in your browser's address bar, choose 'Allow', and try again.",
                        "permission"
                    );
                } 
                else if (error.code === error.POSITION_UNAVAILABLE) {
                    showLocationPopup(
                        "GPS is Off", 
                        "Your phone's hardware GPS is turned off. Please swipe down to turn on your Location/GPS and try again.",
                        "gps"
                    );
                } 
                else if (error.code === error.TIMEOUT) {
                    showLocationPopup(
                        "Timeout", 
                        "It took too long to find your location. Please ensure you have a clear view of the sky or good internet.",
                        "gps"
                    );
                }
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
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

// --- CHECK IN LOGIC ---
async function checkIn() {
    attendanceAction = "checkin";
    const cinBtn = document.getElementById("checkinButton");
    
    // 1. Enter Locating State (Visually indicate work is happening, but don't commit to cache yet)
    const originalHtml = cinBtn.innerHTML;
    cinBtn.innerHTML = `<span class="material-symbols-outlined text-[32px] animate-pulse" style="font-variation-settings: 'FILL' 1;">location_on</span><span class="font-headline-sm text-headline-sm">Locating...</span>`;
    
    try {
        // 2. FETCH LOCATION FIRST (This will throw an error and stop if GPS is off)
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        
        // 3. Location Confirmed! NOW apply Optimistic Update instantly
        setButtonStates(false, true); 
        
        const employeeName = localStorage.getItem("name");
        const employeeEmail = localStorage.getItem("email");
        const now = new Date();
        const date = now.toISOString().split("T")[0];
        const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        const recordId = employeeEmail + "_" + date.replaceAll("-", "");

        let cached = JSON.parse(localStorage.getItem("attendanceCache") || "[]");
        cached.push({ 
            "Employee Email": employeeEmail, 
            "Date": date, 
            "Check In": time, 
            "Check Out": "", 
            "Total Working Hours": "" 
        });
        localStorage.setItem("attendanceCache", JSON.stringify(cached));
        localStorage.setItem("localCheckInTime", Date.now().toString());
        processAttendanceData(cached, employeeEmail);

        // 4. Send to Google Sheets in Background (Fire and forget)
        const data = {
            action: "checkin", recordId, employeeName, employeeEmail, date, checkIn: time, checkInLocation: address
        };
        fetch(API_URL, { method: "POST", body: JSON.stringify(data) }); 

    } catch(error) {
        // LOCATION FAILED: Revert button visually so user can try again
        cinBtn.innerHTML = originalHtml;
        console.error("Check-in aborted due to location issue.");
    }
}

// --- CHECK OUT LOGIC ---
async function checkOut() {
    attendanceAction = "checkout";
    const coutBtn = document.getElementById("checkoutButton");
    
    // 1. Enter Locating State
    const originalHtml = coutBtn.innerHTML;
    coutBtn.innerHTML = `<span class="material-symbols-outlined text-[32px] animate-pulse" style="font-variation-settings: 'FILL' 1;">location_on</span><span class="font-headline-sm text-headline-sm">Locating...</span>`;

    try {
        // 2. FETCH LOCATION FIRST
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        
        // 3. Location Confirmed! NOW apply Optimistic Update instantly
        setButtonStates(false, false); 
        
        const employeeEmail = localStorage.getItem("email");
        const now = new Date();
        const date = now.toISOString().split("T")[0];
        const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        const recordId = employeeEmail + "_" + date.replaceAll("-", "");

        let checkInMs = localStorage.getItem("localCheckInTime") ? parseInt(localStorage.getItem("localCheckInTime")) : (window.currentDbCheckInDate ? window.currentDbCheckInDate.getTime() : null);
        let cleanTimeStr = "--:--";

        if (checkInMs) {
            let diffMs = Math.max(0, Date.now() - checkInMs); 
            let h = Math.floor(diffMs / 3600000);
            let m = Math.floor((diffMs % 3600000) / 60000);
            cleanTimeStr = `${h}h ${m}m`;
        }

        let cached = JSON.parse(localStorage.getItem("attendanceCache") || "[]");
        let todayRecord = cached.reverse().find(r => r["Employee Email"] === employeeEmail && new Date(r.Date).toLocaleDateString("en-IN") === now.toLocaleDateString("en-IN"));
        if (todayRecord) {
            todayRecord["Check Out"] = time;
            todayRecord["Total Working Hours"] = cleanTimeStr;
        }
        localStorage.setItem("attendanceCache", JSON.stringify(cached.reverse()));
        localStorage.removeItem("localCheckInTime");
        processAttendanceData(cached, employeeEmail);

        // 4. Send to Google Sheets in Background
        const data = {
            action: "checkout", recordId, checkOut: time, checkOutLocation: address, totalWorkingHours: cleanTimeStr, TotalWorkingHours: cleanTimeStr
        };
        fetch(API_URL, { method: "POST", body: JSON.stringify(data) });

    } catch(error) {
        // LOCATION FAILED: Revert button visually
        coutBtn.innerHTML = originalHtml;
        console.error("Check-out aborted due to location issue.");
    }
}

// --- RENDER RECENT ACTIVITY ---
function renderList(records) {
    const list = document.getElementById("attendanceList");
    if (!list) return;
    
    if (!records || records.length === 0) {
        list.innerHTML = '<p class="p-4 text-center text-gray-500">No recent activity</p>';
        return;
    }

    const htmlString = records.map(record => {
        const dateStr = new Date(record.Date).toLocaleDateString("en-IN");
        const checkInStr = formatSafeTime(record["Check In"]);
        const checkOutStr = formatSafeTime(record["Check Out"]);
        
        let hours = record["Total Working Hours"] || record["totalWorkingHours"];
        if (!hours || String(hours).includes("NaN")) hours = "--";

        return `
        <div class="flex items-center justify-between p-4 border-b border-surface-container hover:bg-surface-container-low transition-colors">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-surface-container rounded flex items-center justify-center text-primary">
                    <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;">login</span>
                </div>
                <div>
                    <h3 class="font-medium">${dateStr}</h3>
                    <p class="text-sm text-gray-500">${checkInStr} → ${checkOutStr}</p>
                </div>
            </div>
            <div class="text-right">
                <span class="text-sm text-gray-500 font-medium">${hours}</span>
            </div>
        </div>`;
    }).join('');
    
    list.innerHTML = htmlString;
}

// --- CORE PROCESSING LOGIC ---
function processAttendanceData(data, email) {
    const myAttendance = data.filter(r => r["Employee Email"] === email).reverse();
    renderList(myAttendance);
    
    let canCheckIn = true;
    let canCheckOut = false;

    if (myAttendance.length > 0) {
        const latestRecord = myAttendance[0];
        const todayStr = new Date().toLocaleDateString("en-IN");
        const recordDateStr = new Date(latestRecord.Date).toLocaleDateString("en-IN");

        if (todayStr === recordDateStr) {
            if (latestRecord["Check In"] && (!latestRecord["Check Out"] || latestRecord["Check Out"] === "--:--")) {
                canCheckIn = false;
                canCheckOut = true; 
                const safeTimeStr = formatSafeTime(latestRecord["Check In"]);
                window.currentDbCheckInDate = parseTimeStr(safeTimeStr);
            } else if (latestRecord["Check In"] && latestRecord["Check Out"]) {
                canCheckIn = false;
                canCheckOut = false; 
                localStorage.removeItem("localCheckInTime"); 
            }
        }
    }
    setButtonStates(canCheckIn, canCheckOut);
}

// --- INITIAL DATA FETCH (SWR Pattern) ---
async function loadAttendance() {
    const email = localStorage.getItem("email");
    try {
        const profileImg = localStorage.getItem("photo");
        if(profileImg) document.getElementById("profileImage").src = profileImg;
    } catch(e) {}

    // 1. INSTANT LOAD: Check local cache first
    const cachedData = localStorage.getItem("attendanceCache");
    if (cachedData) {
        try {
            processAttendanceData(JSON.parse(cachedData), email);
        } catch (e) {
            console.error("Cache parsing error", e);
        }
    }

    // 2. BACKGROUND SYNC: Fetch fresh data
    try {
        const response = await fetch(API_URL_GET + "?email=" + encodeURIComponent(email));
        const data = await response.json();
        
        localStorage.setItem("attendanceCache", JSON.stringify(data));
        processAttendanceData(data, email);
    } catch (err) {
        console.error("Failed to load live data, relying on cache.", err);
        if (!cachedData) {
            const list = document.getElementById("attendanceList");
            if(list) list.innerHTML = '<p class="p-4 text-center text-error">Failed to load data.</p>';
        }
    }
}

// Start sequence
loadAttendance();
checkLocationStatus(true); // proactively tell the user location status on load




// Check if the browser supports service workers
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}
