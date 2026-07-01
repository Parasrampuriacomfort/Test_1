const API_URL = "https://script.google.com/macros/s/AKfycbyke_kVVkFvk-gLHZUKKHaicgJY2sJ0_ppbgq8kv7b1DK7xpTnYjQVF-Q7CD--5oTmk/exec";

const checkinButton = document.getElementById("checkinButton");
const checkoutButton = document.getElementById("checkoutButton");

checkinButton.addEventListener("click", checkIn);
checkoutButton.addEventListener("click", checkOut);   

function showLocationPopup(message) {

    document.getElementById("locationPopupText").innerText = message;

    document.getElementById("locationPopup").classList.remove("hidden");

}

function closeLocationPopup() {

    document.getElementById("locationPopup").classList.add("hidden");

}
async function enableLocation() {

    closeLocationPopup();

    navigator.geolocation.getCurrentPosition(

        async function(position){

            if(attendanceAction === "checkin"){

                await checkIn();

            }
            else if(attendanceAction === "checkout"){

                await checkOut();

            }

        },

        function(){

            alert("Please enable Location in your phone settings.");

        },

        {
            enableHighAccuracy:true
        }

    );

}


function showLoading(title){

    document.getElementById("loadingTitle").innerText = title;

    document.getElementById("loadingOverlay").classList.remove("hidden");

}

function hideLoading(){

    document.getElementById("loadingOverlay").classList.add("hidden");

}

async function checkIn(){

    attendanceAction = "checkin";

    checkinButton.disabled = true;

    showLoading("Checking In...");

    try{

        const location = await getLocation();

        const address = await getAddress(
            location.latitude,
            location.longitude
        );

        const now = new Date();

        const employeeName = localStorage.getItem("name");

        const employeeEmail = localStorage.getItem("email");

        const date = now.toISOString().split("T")[0];

        const time = now.toLocaleTimeString("en-IN",{

            hour:"2-digit",

            minute:"2-digit"

        });


        
        const recordId =

            employeeEmail + "_" + date.replaceAll("-","");

        const data={

            action:"checkin",

            recordId,

            employeeName,

            employeeEmail,

            date,

            checkIn:time,

            checkInLocation:address

        };

const response = await fetch(API_URL,{
            method:"POST",
            body:JSON.stringify(data)
        });
        const result = await response.text();
        alert(result); 
        window.location.reload();

    }

    catch(error){

        console.error(error);

        alert("Unable to Check In");

    }

    finally{

        hideLoading();

        checkinButton.disabled = false;

    }

}


async function checkOut(){
attendanceAction = "checkout";
    checkoutButton.disabled = true;

    showLoading("Checking Out...");

    try{

        const location = await getLocation();

        const address = await getAddress(
            location.latitude,
            location.longitude
        );

        const now = new Date();

        const employeeEmail = localStorage.getItem("email");

        const date = now.toISOString().split("T")[0];

        const time = now.toLocaleTimeString("en-IN",{

            hour:"2-digit",

            minute:"2-digit"

        });

        const recordId =

            employeeEmail + "_" + date.replaceAll("-","");

            const data={

                action:"checkout",

                recordId,

                checkOut:time,

                checkOutLocation:address

            };

const response = await fetch(API_URL,{
            method:"POST",
            body:JSON.stringify(data)
        });
        const result = await response.text();
        
        alert(result); 
        window.location.reload();

    }

    catch(error){

        console.error(error);

        alert("Unable to Check Out");

    }

    finally{

        hideLoading();

        checkoutButton.disabled = false;

    }

}

async function getLocation() {
    return new Promise((resolve, reject) => {

        if (!navigator.geolocation) {
            return reject("Geolocation is not supported.");
        }

        navigator.geolocation.getCurrentPosition(

            (position) => {

                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                });

            },

            (error) => {

                if (error.code === error.PERMISSION_DENIED) {

                    showLocationPopup(
                        "Location permission is required to mark attendance."
                    );

                } else if (error.code === error.POSITION_UNAVAILABLE) {

                    showLocationPopup(
                        "Location is turned OFF. Please enable GPS."
                    );

                } else if (error.code === error.TIMEOUT) {

                    showLocationPopup(
                        "Unable to get your location."
                    );

                }

                reject(error);

            },

            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }

        );

    });
}

async function getAddress(latitude,longitude){

    const response = await fetch(

`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`

    );

    const data = await response.json();

    const a = data.address;

    return `${a.suburb || ""}, ${a.city || a.town || ""}, ${a.state || ""}`;

}
