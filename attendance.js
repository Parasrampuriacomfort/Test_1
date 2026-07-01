const API_URL = "https://script.google.com/macros/s/AKfycbzJLFvsWpAr3VsNOOUR_uDqDaIC8p_hwbdnUWdmPbRrZYfIq3rGVceW0PKAd8jIb48I/exec";
const API_URL_GET = "https://script.google.com/macros/s/AKfycbzJLFvsWpAr3VsNOOUR_uDqDaIC8p_hwbdnUWdmPbRrZYfIq3rGVceW0PKAd8jIb48I/exec";

const checkinButton = document.getElementById("checkinButton");
const checkoutButton = document.getElementById("checkoutButton");

let attendanceAction = "";
window.currentDbCheckInDate = null; // Store fetched check-in time safely

// --- BUTTON EVENT LISTENERS (Instant Visual Feedback) ---
if (checkinButton) {
    checkinButton.addEventListener("click", () => {
        setButtonStates(false, true); // Instantly turn Check-In Gray, Check-Out Black
        checkIn();
    });
}

if (checkoutButton) {
    checkoutButton.addEventListener("click", () => {
        setButtonStates(false, false); // Instantly turn both Gray
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

function showLoading(title) {
    document.getElementById("loadingTitle").innerText = title;
    document.getElementById("loadingOverlay").classList.remove("hidden");
}

function hideLoading() {
    document.getElementById("loadingOverlay").classList.add("hidden");
}

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

// --- CHECK IN LOGIC ---
async function checkIn() {
    attendanceAction = "checkin";
    showLoading("Checking In...");
    
    try {
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        const now = new Date();
        const employeeName = localStorage.getItem("name");
        const employeeEmail = localStorage.getItem("email");
        const date = now.toISOString().split("T")[0];
        const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        
        const recordId = employeeEmail + "_" + date.replaceAll("-", "");
        
        const data = {
            action: "checkin",
            recordId,
            employeeName,
            employeeEmail,
            date,
            checkIn: time,
            checkInLocation: address
        };

        // Securely save Check-In millisecond to phone for math calculation
        localStorage.setItem("localCheckInTime", Date.now().toString());

        await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
        
        // Dynamically fetch and update UI without reloading the page
        await loadAttendance();
        
    } catch(error) {
        console.error(error);
        alert("Unable to Check In");
        setButtonStates(true, false); // Revert button state if failed
    } finally {
        hideLoading();
    }
}

// --- CHECK OUT LOGIC (With exact hour calculation) ---
async function checkOut() {
    attendanceAction = "checkout";
    showLoading("Checking Out...");
    
    try {
        const location = await getLocation();
        const address = await getAddress(location.latitude, location.longitude);
        const now = new Date();
        const employeeEmail = localStorage.getItem("email");
        const date = now.toISOString().split("T")[0];
        const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        
        const recordId = employeeEmail + "_" + date.replaceAll("-", "");
        
        const data = {
            action: "checkout",
            recordId,
            checkOut: time,
            checkOutLocation: address
        };

        // --- TOTAL WORKING HOURS CALCULATION ---
        let checkInMs = null;
        if (localStorage.getItem("localCheckInTime")) {
            checkInMs = parseInt(localStorage.getItem("localCheckInTime"));
        } else if (window.currentDbCheckInDate) {
            checkInMs = window.currentDbCheckInDate.getTime();
        }

        if (checkInMs) {
            let diffMs = Date.now() - checkInMs;
            if (diffMs < 0) diffMs = 0; 
            
            let h = Math.floor(diffMs / 3600000);
            let m = Math.floor((diffMs % 3600000) / 60000);
            
            // Output pure hours and minutes only (e.g., 8h 30m)
            const cleanTimeStr = `${h}h ${m}m`;
            data.totalWorkingHours = cleanTimeStr;
            data.TotalWorkingHours = cleanTimeStr; 
        }
        
        // Clean up data for the next day
        localStorage.removeItem("localCheckInTime");

        await fetch(API_URL, { method: "POST", body: JSON.stringify(data) });
        
        // Dynamically fetch and update UI without reloading the page
        await loadAttendance();
        
    } catch(error) {
        console.error(error);
        alert("Unable to Check Out");
        setButtonStates(false, true); // Revert button state if failed
    } finally {
        hideLoading();
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

// --- INITIAL DATA FETCH ---
async function loadAttendance() {
    const email = localStorage.getItem("email");
    try {
        const profileImg = localStorage.getItem("photo");
        if(profileImg) document.getElementById("profileImage").src = profileImg;
    } catch(e) {}

    try {
        const response = await fetch(API_URL_GET + "?email=" + encodeURIComponent(email));
        const data = await response.json();
        
        const myAttendance = data.filter(r => r["Employee Email"] === email).reverse();
        renderList(myAttendance);
        
        // Day Reset Logic (Checks if today has records)
        let canCheckIn = true;
        let canCheckOut = false;

        if (myAttendance.length > 0) {
            const latestRecord = myAttendance[0];
            const todayStr = new Date().toLocaleDateString("en-IN");
            const recordDateStr = new Date(latestRecord.Date).toLocaleDateString("en-IN");

            if (todayStr === recordDateStr) {
                if (latestRecord["Check In"] && !latestRecord["Check Out"]) {
                    canCheckIn = false;
                    canCheckOut = true; // Waiting to check out
                    
                    // Capture Check-In time for math calculation in case user closed the app
                    const safeTimeStr = formatSafeTime(latestRecord["Check In"]);
                    window.currentDbCheckInDate = parseTimeStr(safeTimeStr);
                    
                } else if (latestRecord["Check In"] && latestRecord["Check Out"]) {
                    canCheckIn = false;
                    canCheckOut = false; // Finished day, disabled until tomorrow
                    localStorage.removeItem("localCheckInTime"); 
                }
            }
        }
        setButtonStates(canCheckIn, canCheckOut);

    } catch (err) {
        console.error("Failed to load data", err);
        const list = document.getElementById("attendanceList");
        if(list) list.innerHTML = '<p class="p-4 text-center text-error">Failed to load data.</p>';
    }
}

// Start sequence
loadAttendance();
