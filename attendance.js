const API_URL = "https://script.google.com/macros/s/AKfycbya3Rq7zL3zTWCDaF5T1OCKz0BrsA2IPLB3mz826_ngcgowRgHY_rVkaS8YZDwvBNcA/exec";
const API_URL_GET = "https://script.google.com/macros/s/AKfycbya3Rq7zL3zTWCDaF5T1OCKz0BrsA2IPLB3mz826_ngcgowRgHY_rVkaS8YZDwvBNcA/exec";

const checkinButton = document.getElementById("checkinButton");
const checkoutButton = document.getElementById("checkoutButton");

let attendanceAction = "";
window.currentDbCheckInDate = null; 

// --- BUTTON EVENT LISTENERS ---
if (checkinButton) {
    checkinButton.addEventListener("click", () => {
        setButtonStates(false, true); 
        checkIn();
    });
}

if (checkoutButton) {
    checkoutButton.addEventListener("click", () => {
        setButtonStates(false, false); 
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
    }
    
    if (coutBtn) {
        coutBtn.disabled = !canCheckOut;
        coutBtn.className = canCheckOut ? activeClass : disabledClass;
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

// --- MODALS & LOADERS ---
function showLocationPopup(message = "Location is required.") {
    document.getElementById("locationPopupText").innerText = message;
    document.getElementById("locationPopup").classList.remove("hidden");
}

function closeLocationPopup() {
    document.getElementById("locationPopup").classList.add("hidden");
}

// (Loading overlay is removed from normal flow to make UI feel instant, only errors show alerts now)

async function enableLocation() {
    closeLocationPopup();
    navigator.geolocation.getCurrentPosition(
        async function(position) {
            if (attendanceAction === "checkin") await checkIn();
            else if (attendanceAction === "checkout") await checkOut();
        },
        function() { alert("Please enable Location in your phone settings."); },
        { enableHighAccuracy: true }
    );
}

// --- LOCATION FETCHING ---
async function getLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject("Geolocation is not supported.");
        
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
            (error) => {
                if (error.code === error.PERMISSION_DENIED) showLocationPopup("Location permission is required to mark attendance.");
                else if (error.code === error.POSITION_UNAVAILABLE) showLocationPopup("Location is turned OFF. Please enable GPS.");
                else if (error.code === error.TIMEOUT) showLocationPopup("Unable to get your location.");
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 } // Reduced timeout slightly
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
    const employeeName = localStorage.getItem("name");
    const employeeEmail = localStorage.getItem("email");
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const recordId = employeeEmail + "_" + date.replaceAll("-", "");

    // 1. Optimistic Update (Instant Feedback)
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

    try {
        // 2. Process Background GPS and Network Task
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        
        const data = {
            action: "checkin", recordId, employeeName, employeeEmail, date, checkIn: time, checkInLocation: address
        };
        fetch(API_URL, { method: "POST", body: JSON.stringify(data) }); // Fire and forget
    } catch(error) {
        console.error(error);
        alert("Unable to acquire location for Check-In. Please ensure GPS is active.");
        // We could revert the UI state here if strict validation is needed
    }
}

// --- CHECK OUT LOGIC ---
async function checkOut() {
    attendanceAction = "checkout";
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

    // 1. Optimistic Update
    let cached = JSON.parse(localStorage.getItem("attendanceCache") || "[]");
    let todayRecord = cached.reverse().find(r => r["Employee Email"] === employeeEmail && new Date(r.Date).toLocaleDateString("en-IN") === now.toLocaleDateString("en-IN"));
    if (todayRecord) {
        todayRecord["Check Out"] = time;
        todayRecord["Total Working Hours"] = cleanTimeStr;
    }
    localStorage.setItem("attendanceCache", JSON.stringify(cached.reverse()));
    localStorage.removeItem("localCheckInTime");
    processAttendanceData(cached, employeeEmail);

    try {
        // 2. Process Background Task
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        
        const data = {
            action: "checkout", recordId, checkOut: time, checkOutLocation: address, totalWorkingHours: cleanTimeStr, TotalWorkingHours: cleanTimeStr
        };
        fetch(API_URL, { method: "POST", body: JSON.stringify(data) }); // Fire and forget
    } catch(error) {
        console.error(error);
        alert("Unable to acquire location for Check-Out.");
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

    // 1. INSTANT LOAD: Check local cache first and render immediately
    const cachedData = localStorage.getItem("attendanceCache");
    if (cachedData) {
        try {
            processAttendanceData(JSON.parse(cachedData), email);
        } catch (e) {
            console.error("Cache parsing error", e);
        }
    }

    // 2. BACKGROUND SYNC: Fetch fresh data from Google Apps Script
    try {
        const response = await fetch(API_URL_GET + "?email=" + encodeURIComponent(email));
        const data = await response.json();
        
        // Update cache with fresh data
        localStorage.setItem("attendanceCache", JSON.stringify(data));
        
        // Re-render transparently to sync any background changes
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
