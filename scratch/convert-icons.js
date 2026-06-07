// scratch/convert-icons.js
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
    'profile.html'
];

const iconMap = {
    'home-outline': 'home',
    'home': 'home',
    'calendar-outline': 'calendar_today',
    'calendar': 'calendar_today',
    'add-circle-outline': 'add_circle',
    'add-circle': 'add_circle',
    'cube-outline': 'inventory_2',
    'cube': 'inventory_2',
    'globe-outline': 'public',
    'globe': 'public',
    'chatbubble-ellipses-outline': 'chat',
    'chatbubble-ellipses': 'chat',
    'settings-outline': 'settings',
    'settings': 'settings',
    'menu-outline': 'menu',
    'menu': 'menu',
    'notifications-outline': 'notifications',
    'notifications': 'notifications',
    'bar-chart-outline': 'bar_chart',
    'bar-chart': 'bar_chart',
    'log-out-outline': 'logout',
    'log-out': 'logout',
    'checkmark-done-outline': 'done_all',
    'checkmark-done': 'done_all',
    'alert-circle-outline': 'info',
    'alert-circle': 'info',
    'warning-outline': 'warning',
    'warning': 'warning',
    'eye-outline': 'visibility',
    'eye': 'visibility',
    'camera-outline': 'photo_camera',
    'camera': 'photo_camera',
    'people-outline': 'group',
    'people': 'group',
    'chevron-down-outline': 'keyboard_arrow_down',
    'chevron-down': 'keyboard_arrow_down',
    'trash-outline': 'delete',
    'trash': 'delete',
    'close-outline': 'close',
    'close': 'close',
    'mail-outline': 'mail',
    'mail': 'mail',
    'lock-closed-outline': 'lock',
    'lock-closed': 'lock',
    'person-outline': 'person',
    'person': 'person',
    'call-outline': 'call',
    'call': 'call',
    'eye-off-outline': 'visibility_off',
    'eye-off': 'visibility_off',
    'logo-whatsapp': 'chat',
    'business-outline': 'store',
    'business': 'store'
};

htmlFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${file}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Replace <ion-icon ... name="..." ...></ion-icon>
    // We match name attribute and keep other attributes
    const ionIconRegex = /<ion-icon\s+([^>]*?)><\/ion-icon>/gi;

    let matchCount = 0;
    const newContent = content.replace(ionIconRegex, (match, attrs) => {
        // Extract the name attribute
        const nameMatch = attrs.match(/name=["']([^"']+)["']/i);
        if (!nameMatch) return match;

        const originalName = nameMatch[1];
        const mappedName = iconMap[originalName.toLowerCase()] || originalName;

        // Strip the name attribute from attributes to not clutter
        const cleanAttrs = attrs.replace(/name=["']([^"']+)["']/gi, '').trim();

        matchCount++;
        return `<span class="material-symbols-outlined" ${cleanAttrs}>${mappedName}</span>`;
    });

    // Also remove the Ionicons script tags if present
    const cleanContent = newContent.replace(/<script[^>]*ionicons[^>]*><\/script>/gi, '');

    if (matchCount > 0) {
        fs.writeFileSync(filePath, cleanContent, 'utf8');
        console.log(`Updated ${file}: replaced ${matchCount} icons`);
    } else {
        console.log(`No icons replaced in ${file}`);
    }
});
