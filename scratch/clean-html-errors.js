// scratch/clean-html-errors.js
const fs = require('fs');
const path = require('path');

const htmlFiles = [
    'add.html',
    'ai-assistant.html',
    'booking.html',
    'bookings.html',
    'dashboard.html',
    'inventory.html',
    'log-in.html',
    'public.html',
    'settings.html',
    'signup.html',
    'setup.html',
    'profile.html',
    'index.html'
];

htmlFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${file}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Remove missing SDK scripts
    // e.g., <script src="/_sdk/element_sdk.js"></script>
    // or <script src="/_sdk/data_sdk.js" type="text/javascript"></script>
    const beforeRemoveLength = content.length;
    content = content.replace(/<script[^>]*\/_sdk\/element_sdk\.js[^>]*><\/script>/gi, '');
    content = content.replace(/<script[^>]*\/_sdk\/data_sdk\.js[^>]*><\/script>/gi, '');

    // 2. Convert onesignal.js script to type="module"
    // e.g., <script src="assets/js/onesignal.js" defer></script>
    // to <script type="module" src="assets/js/onesignal.js" defer></script>
    content = content.replace(/<script\s+src=["']assets\/js\/onesignal\.js["']([^>]*)><\/script>/gi, '<script type="module" src="assets/js/onesignal.js"$1></script>');
    content = content.replace(/<script\s+([^>]*?)src=["']assets\/js\/onesignal\.js["']([^>]*)><\/script>/gi, '<script type="module" $1 src="assets/js/onesignal.js"$2></script>');

    if (content.length !== beforeRemoveLength || content.includes('type="module" src="assets/js/onesignal.js"')) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Cleaned up HTML errors in ${file}`);
    } else {
        console.log(`No changes made to ${file}`);
    }
});
