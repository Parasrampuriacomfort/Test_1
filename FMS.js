// --- APP CONFIGURATION ---
const API_URL = "https://script.google.com/macros/s/AKfycbyXnRv1ows5y7sfXyFF4geXxN1taLiuxds9IfETZlQzZWA8JpwAQ9XLGaN9Ga1P8F7qew/exec"; 
let globalOrders = [];

// --- MULTI-STEP CAMERA LOGIC ---
let stream = null;
let loaderInterval;

let pendingUploads = 0; // Tracks how many items are currently saving to Google
let isSyncing = false;

// ============================================================
// FIX #1: SPEED — lower camera resolution so Step 2 isn't laggy
// (previously no width/height was requested, so phones defaulted
// to their max resolution, e.g. 4K, which is heavy to render,
// draw to canvas, and compress on every capture)
// ============================================================
async function startCamera(step) {
    const feed = document.getElementById(`camera-feed-${step}`);
    const preview = document.getElementById(`camera-preview-${step}`);
    const overlay = document.getElementById(`camera-overlay-${step}`);
    const btnCapture = document.getElementById(`btn-capture-${step}`);
    const actionBtns = document.getElementById(`action-buttons-post-capture-${step}`);

    // Reset UI to "Live" state for this specific step
    feed.classList.remove('hidden');
    preview.classList.add('hidden');
    overlay.classList.remove('hidden');
    btnCapture.classList.remove('hidden');
    actionBtns.classList.add('hidden');
    actionBtns.classList.remove('flex');

    try {
        if(stream) stopCamera(); // kill any running camera before starting a new one
        stream = await navigator.mediaDevices.getUserMedia({ 
         video: { 
                facingMode: 'environment',
                width: { ideal: 1280 }, // 720p is standard and runs smooth
                height: { ideal: 720 },
                frameRate: { ideal: 30 } // Native fluid framerate
            },
            audio: false 
        });
        
        // Force lightweight playback attributes via JS (in case they're
        // missing in the HTML) — these matter a lot for smooth <video>
        // rendering inside WebViews/PWAs.
        feed.setAttribute('playsinline', '');
        feed.setAttribute('muted', '');
        feed.muted = true;
        feed.disablePictureInPicture = true;
        
        feed.srcObject = stream;
        
        feed.onloadedmetadata = () => {
            feed.play();
            overlay.classList.add('hidden'); // hide the loading text once video plays
        };
    } catch (err) {
        console.error(`Camera ${step} error:`, err);
        overlay.innerHTML = `<span class="material-symbols-outlined text-error text-5xl">no_photography</span><span class="text-error font-label-md">Camera Access Denied</span>`;
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
}

// Waits for the bottom sheet's slide-up transition to fully finish
// before running `callback`. This avoids starting the camera WHILE
// the sheet is still animating (transform transition + camera
// negotiation competing at the same time was the main lag source).
function afterSheetOpens(callback) {
    const sheet = document.getElementById('order-bottom-sheet');
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        sheet.removeEventListener('transitionend', handler);
        
        // Defer the heavy camera boot until after the next browser paint
        requestAnimationFrame(() => {
            setTimeout(callback, 100); 
        });
    };
    const handler = (e) => {
        if (e.propertyName === 'transform') finish();
    };
    sheet.addEventListener('transitionend', handler);
    setTimeout(finish, 400); // Safety fallback
}

function capturePhoto(step) {
    if (!stream) return;

    const feed = document.getElementById(`camera-feed-${step}`);
    const canvas = document.getElementById(`camera-canvas-${step}`);
    const preview = document.getElementById(`camera-preview-${step}`);

    canvas.width = feed.videoWidth;
    canvas.height = feed.videoHeight;

    const ctx = canvas.getContext('2d');

    // Mirror image (Left ↔ Right)
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(feed, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    preview.src = canvas.toDataURL('image/jpeg', 0.8);

    feed.classList.add('hidden');
    preview.classList.remove('hidden');
    document.getElementById(`btn-capture-${step}`).classList.add('hidden');
    document.getElementById(`action-buttons-post-capture-${step}`).classList.remove('hidden');
    document.getElementById(`action-buttons-post-capture-${step}`).classList.add('flex');

    stopCamera();
}

function retakePhoto(step) {
    startCamera(step);
}

// --- POPUP FLOW LOGIC ---

function completeStep1() {
    stopCamera(); // Make sure camera 1 is dead
    
    document.getElementById('camera-section-1').classList.add('hidden');
    document.getElementById('step-1-success').classList.remove('hidden');
    
    const step2 = document.getElementById('step-2-container');
    step2.classList.remove('hidden');
    step2.classList.add('flex');
    
    document.getElementById('tab-btn-1').classList.remove('border-primary', 'text-primary');
    document.getElementById('tab-btn-2').classList.add('border-primary', 'text-primary');

    // Give DOM time to update classes
    requestAnimationFrame(() => {
        step2.classList.remove('opacity-50', 'pointer-events-none');
        step2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Wait 500ms for the smooth scroll to completely finish before freezing the thread with getUserMedia
        setTimeout(() => {
            startCamera(2); 
        }, 500);
    });
}

function completeDispatch() {
    closeBottomSheet();
}

// ============================================================
// FIX #2: BACK BUTTON — close the sheet instead of the whole app
//
// How it works: the moment the sheet opens we push a dummy
// history entry. Phone's back button then just pops THAT entry
// (fires 'popstate') instead of leaving the page/app. We catch
// popstate and close the sheet's UI there.
//
// Any place that used to call closeBottomSheet() directly now
// goes through history.back(), which triggers the same popstate
// handler — so there's only one place that actually closes the UI.
// ============================================================
let sheetHistoryPushed = false;

function closeBottomSheet() {
    if (sheetHistoryPushed) {
        // This will trigger the popstate listener below,
        // which actually hides the sheet.
        history.back();
    } else {
        actuallyCloseBottomSheet();
    }
}

function actuallyCloseBottomSheet() {
    document.getElementById('bottom-sheet-backdrop').classList.add('opacity-0', 'pointer-events-none');
    document.getElementById('order-bottom-sheet').classList.add('translate-y-full');
    stopCamera();
    sheetHistoryPushed = false;
}

window.addEventListener('popstate', () => {
    if (sheetHistoryPushed) {
        actuallyCloseBottomSheet();
    }
});

// --- DATA FETCHING & RENDERING (SWR Pattern) ---

let isFetching = false;

document.addEventListener("DOMContentLoaded", () => {
    loadOrders();          // Initial fast load
    startSilentPolling();  // Start the heartbeat
    processSyncQueue();    // Check if there are left-over images to upload!
});
     
async function loadOrders() {
    const cachedData = localStorage.getItem("fms_orders_cache");
    
    // 1. Show cached data instantly
    if (cachedData) {
        try {
            globalOrders = JSON.parse(cachedData);
            renderOrders(globalOrders);
            document.getElementById('loader').classList.add('hidden');
        } catch(e) {
            console.error("Cache parsing error", e);
        }
    } else {
        document.getElementById('loader').classList.remove('hidden');
    }

    // 2. Fetch fresh data in background
    if (isFetching) return;
    isFetching = true;
    try {
        const response = await fetch(API_URL);
        const freshData = await response.json();
        
        if(freshData && freshData.length > 0) {
            // Only re-render if the server data is actually different from our cache
            if(JSON.stringify(freshData) !== JSON.stringify(globalOrders)) {
                globalOrders = freshData;
                localStorage.setItem("fms_orders_cache", JSON.stringify(freshData));
                renderOrders(freshData);
            }
        }
    } catch (error) {
        console.error("API error:", error);
    } finally {
        isFetching = false;
        document.getElementById('loader').classList.add('hidden');
    }
}

function openBottomSheet(invoiceNo) {
    const order = globalOrders.find(o => o["Invoice No"] == invoiceNo);
    
    if (order) {
        document.getElementById('bs-invoice').textContent = `#INV-${order["Invoice No"]}`;
        document.getElementById('bs-customer').textContent = order["Customer Name"] || "N/A";
        
        const isUrgent = order["Urgency"] === "Urgent";
        const urgencyEl = document.getElementById('bs-urgency');
        const timeEl = document.getElementById('bs-time');

        if (isUrgent) {
            urgencyEl.innerHTML = '<span class="material-symbols-outlined text-sm">warning</span> Urgent';
            urgencyEl.className = "font-body-md text-body-md text-error font-bold flex items-center gap-1";
            timeEl.className = "font-body-md text-body-md text-error font-bold";
        } else {
            urgencyEl.textContent = order["Urgency"] || 'Normal';
            urgencyEl.className = "font-body-md text-body-md text-primary font-bold";
            timeEl.className = "font-body-md text-body-md text-primary font-bold";
        }

        const formatTimeStr = (dateString) => {
             if(!dateString) return "--:--";
             let d = new Date(dateString);
             return isNaN(d) ? dateString : d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        };

        timeEl.textContent = formatTimeStr(order["Timestamp"]);
        
        const tab1 = document.getElementById('tab-btn-1');
        const tab2 = document.getElementById('tab-btn-2');
        const step1Container = document.getElementById('step-1-container');
        const step2Container = document.getElementById('step-2-container');
        
        tab1.classList.remove('border-primary', 'text-primary');
        tab2.classList.remove('border-primary', 'text-primary');

        const safeCheck = (val) => val && val.toString().trim().toLowerCase() === "done";
        
        const step1Done = safeCheck(order["Status of Goods Out"]);
        const step2Done = safeCheck(order["Status of Dispatch"]);

        if (!sheetHistoryPushed) {
            history.pushState({ modal: 'orderSheet' }, '');
            sheetHistoryPushed = true;
        }

        // --- HELPER TO PREVENT JANK ---
        // This forces the phone to calculate the UI layout *before* animating
        const animateSheetOpen = (stepCallback) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    document.getElementById('bottom-sheet-backdrop').classList.remove('opacity-0', 'pointer-events-none');
                    document.getElementById('order-bottom-sheet').classList.remove('translate-y-full');
                    afterSheetOpens(stepCallback);
                });
            });
        };

        if (step1Done && !step2Done) {
            // --- STEP 1 IS DONE: Show Summary Card & Open Step 2 ---
            
            document.getElementById('step-1-planned-time').textContent = formatTimeStr(order["Planned Time for Goods Out"]);
            document.getElementById('step-1-actual-time').textContent = formatTimeStr(order["Actual Time for Goods Out"]);
            
            const step1ImgEl = document.getElementById('step-1-summary-img');
            const step1IconEl = document.getElementById('step-1-summary-icon');
            const sheetImgUrl = order["Image Url of Step 1"];

            if (sheetImgUrl) {
                const idMatch = sheetImgUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || sheetImgUrl.match(/id=([a-zA-Z0-9_-]+)/);
                
                if (idMatch && idMatch[1]) {
                    const fileId = idMatch[1];
                    step1ImgEl.classList.add('hidden');
                    step1IconEl.classList.remove('hidden');
                    step1IconEl.style.cursor = 'pointer';
                    step1IconEl.onclick = () => {
                        step1ImgEl.src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
                        step1ImgEl.onload = () => {
                            step1ImgEl.classList.remove('hidden');
                            step1IconEl.classList.add('hidden');
                        };
                    };
                } else {
                    step1ImgEl.classList.add('hidden');
                    step1IconEl.classList.remove('hidden');
                }
            } else {
                step1ImgEl.classList.add('hidden');
                step1IconEl.classList.remove('hidden');
            }

            // DO ALL HEAVY DOM CHANGES HERE
            step1Container.classList.remove('hidden');
            document.getElementById('camera-section-1').classList.add('hidden');
            document.getElementById('step-1-success').classList.remove('hidden');

            step2Container.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
            step2Container.classList.add('flex');
            tab2.classList.add('border-primary', 'text-primary');
            
            // Trigger animation cleanly
            animateSheetOpen(() => startCamera(2));

        } else if (!step1Done) {
            // --- STEP 1 IS NOT DONE: Open Step 1 ---
            
            // DO ALL HEAVY DOM CHANGES HERE
            step1Container.classList.remove('hidden');
            document.getElementById('camera-section-1').classList.remove('hidden');
            document.getElementById('step-1-success').classList.add('hidden');
            
            step2Container.classList.add('hidden', 'opacity-50', 'pointer-events-none');
            step2Container.classList.remove('flex');
            tab1.classList.add('border-primary', 'text-primary');
            
            // Trigger animation cleanly
            animateSheetOpen(() => startCamera(1));
            
        } else {
            alert("This order has been fully dispatched.");
            if (sheetHistoryPushed) {
                history.back();
            }
            return;
        }
    }
}

function renderOrders(orders) {
    const container = document.getElementById('orders-container');
    container.innerHTML = ""; 

    // 1. Sort all orders by Timestamp, NEWEST first (Descending)
    const sortedOrders = [...orders].sort((a, b) => {
        const dateA = new Date(a["Timestamp"]).getTime();
        const dateB = new Date(b["Timestamp"]).getTime();
        return (dateB || 0) - (dateA || 0); // Handles missing dates gracefully
    });

    // 2. Group by date string, using a Map to STRICTLY preserve the sorted order
    const groupedOrders = new Map();
    
    sortedOrders.forEach(order => {
        let dateObj = new Date(order["Timestamp"]);
        if(isNaN(dateObj)) dateObj = new Date(); 
        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        if (!groupedOrders.has(dateStr)) {
            groupedOrders.set(dateStr, []);
        }
        groupedOrders.get(dateStr).push(order);
    });

    // Bulletproof check for progress bars
    const safeCheck = (val) => val && val.toString().trim().toLowerCase() === "done";

    // 3. Render the groups
    for (const [date, dailyOrders] of groupedOrders) {
        const section = document.createElement('section');
        section.className = "flex flex-col gap-stack-md mb-4";
        
        const header = document.createElement('h3');
        header.className = "font-label-md text-label-md text-secondary uppercase tracking-wider mb-2";
        
        const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        let yesterdayObj = new Date();
        yesterdayObj.setDate(yesterdayObj.getDate() - 1);
        const yesterdayStr = yesterdayObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        if (date === todayStr) header.innerText = `Today, ${date.split(',')[1]}`;
        else if (date === yesterdayStr) header.innerText = `Yesterday, ${date.split(',')[1]}`;
        else header.innerText = date;
        
        section.appendChild(header);

        dailyOrders.forEach(order => {
            const isUrgent = order["Urgency"] === "Urgent";
            
            let progressWidth = "w-[0%]";
            if (safeCheck(order["Status of Dispatch"])) progressWidth = "w-full";
            else if (safeCheck(order["Status of Goods Out"])) progressWidth = "w-1/2";

            let timeStr = "--:--";
            if(order["Timestamp"]) {
                 let tDate = new Date(order["Timestamp"]);
                 if(!isNaN(tDate)) timeStr = tDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }

            const articleHtml = `
                <article class="bg-surface-container-lowest rounded-lg shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-surface-container-high relative overflow-hidden group hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.08)] transition-shadow duration-300 p-4 cursor-pointer" onclick="openBottomSheet('${order["Invoice No"]}')">
                    <div class="absolute left-0 top-0 bottom-0 w-1 ${isUrgent ? 'bg-error' : 'bg-primary-fixed-dim'}"></div>
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex flex-col">
                            <span class="font-label-sm text-label-sm text-secondary">#INV-${order["Invoice No"]}</span>
                            <h2 class="font-headline-sm text-headline-sm text-primary truncate max-w-[200px]">${order["Customer Name"] || 'N/A'}</h2>
                        </div>
                        <div class="text-right">
                            <p class="font-label-sm text-label-sm ${isUrgent ? 'text-error' : 'text-secondary'} uppercase">Time</p>
                            <p class="font-body-sm text-body-sm ${isUrgent ? 'font-bold text-error' : 'text-on-surface'}">${timeStr}</p>
                        </div>
                    </div>
                    <div class="pt-2 border-t border-outline-variant">
                        <div class="flex justify-between items-center mb-1">
                            <span class="font-label-sm text-label-sm text-primary">Goods Out</span>
                            <span class="font-label-sm text-label-sm text-secondary">Dispatch</span>
                        </div>
                        <div class="relative w-full h-1 bg-surface-container-high rounded-full">
                            <div class="absolute top-0 left-0 h-1 bg-primary rounded-full ${progressWidth} transition-all duration-500"></div>
                            <div class="absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 w-2 h-2 bg-primary rounded-full"></div>
                            <div class="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 ${progressWidth === 'w-full' || progressWidth === 'w-1/2' ? 'bg-primary border-2 border-surface-container-lowest' : 'bg-surface-container-highest'} rounded-full transition-all duration-500"></div>
                            <div class="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-2 h-2 ${progressWidth === 'w-full' ? 'bg-primary border-2 border-surface-container-lowest scale-150' : 'bg-surface-container-highest'} rounded-full transition-all duration-500"></div>
                        </div>
                    </div>
                </article>
            `;
            
            const template = document.createElement('template');
            template.innerHTML = articleHtml.trim();
            section.appendChild(template.content.firstChild);
        });

        container.appendChild(section);
    }
}

async function saveStepToSheet(stepNumber){
    const canvas = document.getElementById(`camera-canvas-${stepNumber}`);
    
    // Pro-Tip: Compress the image slightly so it doesn't max out LocalStorage
    const imageData = canvas.toDataURL("image/jpeg", 0.6); 
    
    const invoiceNo = document.getElementById("bs-invoice").textContent.replace("#INV-","");
    
    let deliveryType = "";
    if (stepNumber === 2) {
        const typeSelect = document.getElementById("delivery-type");
        deliveryType = typeSelect ? typeSelect.value : "";
        if (!deliveryType) {
            alert("Please select a Delivery Type before saving.");
            return;
        }
    }

    const saveBtn = document.querySelector(`button[onclick="saveStepToSheet(${stepNumber})"]`);
    saveBtn.disabled = true;
    saveBtn.innerHTML = "Saving...";
    showLoader("Updating...");

    // 1. OPTIMISTIC UI UPDATE
    const orderIndex = globalOrders.findIndex(o => String(o["Invoice No"]) === String(invoiceNo));
    if (orderIndex !== -1) {
        if (stepNumber === 1) {
            globalOrders[orderIndex]["Status of Goods Out"] = "Done";
            globalOrders[orderIndex]["Actual Time for Goods Out"] = new Date().toISOString();
        } else if (stepNumber === 2) {
            globalOrders[orderIndex]["Status of Dispatch"] = "Done";
            globalOrders[orderIndex]["Actual Time for Dispatch"] = new Date().toISOString();
        }
        localStorage.setItem("fms_orders_cache", JSON.stringify(globalOrders));
        renderOrders(globalOrders);
    }

    // 2. SAVE TO OFFLINE QUEUE
    const payload = {
        invoiceNo: invoiceNo,
        filename: `${invoiceNo}_Step_${stepNumber}.jpg`, // Changed to jpg to match compression
        image: imageData
    };
    if (stepNumber === 2) payload.deliveryType = deliveryType;

    let queue = JSON.parse(localStorage.getItem('fms_sync_queue') || '[]');
    queue.push(payload);
    localStorage.setItem('fms_sync_queue', JSON.stringify(queue));

    // 3. START BACKGROUND SYNC
    processSyncQueue();

    // 4. CLOSE UI INSTANTLY
    showLoaderSuccess("Saved!");
    setTimeout(() => {
        closeBottomSheet();
        hideLoader();
    }, 600);

    saveBtn.disabled = false;
    saveBtn.innerHTML = "Save";
}
function showLoader(text = "Loading...") {

    document.getElementById("loadingOverlay").classList.remove("hidden");

    document.getElementById("loadingText").textContent = text;

    document.getElementById("loaderProgress").classList.remove("hidden");

    document.getElementById("loaderSuccess").classList.add("hidden");

    const successCircle =
        document.querySelector("#loaderSuccess > div");

    successCircle.classList.remove("scale-100","opacity-100");
    successCircle.classList.add("scale-50","opacity-0");

    const bar = document.getElementById("loadingBar");

    let progress = 8;

    bar.style.width = progress + "%";

    clearInterval(loaderInterval);

    loaderInterval = setInterval(() => {

        progress += Math.random()*12;

        if(progress>90)
            progress=90;

        bar.style.width = progress + "%";

    },180);

}

function showLoaderSuccess(text="Saved Successfully"){

    clearInterval(loaderInterval);

    const bar = document.getElementById("loadingBar");

    bar.style.width="100%";

    setTimeout(()=>{

        document.getElementById("loaderProgress").classList.add("hidden");

        document.getElementById("loadingText").textContent=text;

        document.getElementById("loaderSuccess").classList.remove("hidden");

        requestAnimationFrame(()=>{

            const circle=document.querySelector("#loaderSuccess > div");

            circle.classList.remove("scale-50","opacity-0");

            circle.classList.add("scale-100","opacity-100");

        });

    },250);

}

function hideLoader(){

    setTimeout(()=>{

        document.getElementById("loadingOverlay").classList.add("hidden");

        document.getElementById("loadingBar").style.width="0%";

    },900);

}

// Checks the server every 10 seconds without showing a loading spinner
function startSilentPolling() {
    setInterval(async () => {
        if (isFetching) return; 
        if (stream) return; // camera is active (sheet open) — skip this cycle to avoid lag
        isFetching = true;

        try {
            const response = await fetch(API_URL);
            const freshData = await response.json();
            
            // If the data has changed...
            if (freshData && JSON.stringify(freshData) !== JSON.stringify(globalOrders)) {
                
                // 1. Get a list of all the Invoice Numbers we ALREADY have on screen
                const existingInvoices = new Set(globalOrders.map(o => o["Invoice No"]));
                
                // 2. Tag the brand new ones (only if this isn't the very first time the app is loading)
                if (existingInvoices.size > 0) {
                    freshData.forEach(order => {
                        if (!existingInvoices.has(order["Invoice No"])) {
                            order._isNewlyAdded = true; // Flag for animation
                            
                            // Remove the flag after 3 seconds so it doesn't re-animate if they click it later
                            setTimeout(() => { delete order._isNewlyAdded; }, 3000);
                        }
                    });
                }

                console.log("New order detected! Updating UI quietly...");
                globalOrders = freshData;
                localStorage.setItem("fms_orders_cache", JSON.stringify(freshData));
                renderOrders(freshData);
            }
        } catch (error) {
            console.error("Silent background sync failed:", error);
        } finally {
            isFetching = false;
        }
    }, 10000); // 10 seconds
}


async function processSyncQueue() {
    if (isSyncing) return; // Don't run multiple at once
    
    let queue = JSON.parse(localStorage.getItem('fms_sync_queue') || '[]');
    if (queue.length === 0) return; // Nothing to sync

    isSyncing = true;
    
    // Take the first item in the line
    let payload = queue[0];

    try {
        console.log(`Attempting background sync for Invoice ${payload.invoiceNo}...`);
        const response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();

        if (result.status === "success") {
            console.log(`Successfully synced Invoice ${payload.invoiceNo}!`);
            
            // It worked! Remove it from the queue
            queue = JSON.parse(localStorage.getItem('fms_sync_queue') || '[]');
            queue.shift(); // Removes the first item
            localStorage.setItem('fms_sync_queue', JSON.stringify(queue));
            
            // Loop back and process the next one if there are more
            isSyncing = false;
            processSyncQueue(); 
        } else {
            console.error("Server rejected sync:", result.message);
            isSyncing = false;
        }
    } catch (e) {
        console.error("Sync failed (Offline or closed early). Will try again next time.", e);
        isSyncing = false;
    }
}


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
