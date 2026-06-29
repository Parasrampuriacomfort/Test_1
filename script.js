// Grab the elements from our HTML structure
const nameInput = document.getElementById('nameInput');
const greetButton = document.getElementById('greetButton');
const greetingMessage = document.getElementById('greetingMessage');

// Listen for a click event on the button
greetButton.addEventListener('click', function() {
    const userName = nameInput.value;
    
    // Check if the user actually typed something
    if (userName !== "") {
        greetingMessage.textContent = `Hello, ${userName}! 👋`;
    } else {
        greetingMessage.textContent = "Please enter a name!";
    }
});
