import { db } from './firebase-config.js'; // Your firebase init file
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// Global Chart Instances (to update them later)
let revenueChart;
let categoryChart;

async function loadBusinessAnalytics() {
    const businessId = localStorage.getItem('businessId'); // Assuming you store ID on login
    const bookingsRef = collection(db, "bookings");
    
    // 1. Fetch all bookings for this specific business
    const q = query(bookingsRef, where("businessId", "==", businessId), orderBy("timestamp", "desc"));
    const querySnapshot = await getDocs(q);

    let totalRevenue = 0;
    let customerStats = {}; // { customerName: { totalSpent: 0, items: [], status: '' } }
    let itemPopularity = {}; // { itemName: count }
    let monthlyRevenue = { 'Jan': 0, 'Feb': 0, 'Mar': 0, 'Apr': 0, 'May': 0, 'Jun': 0 };

    querySnapshot.forEach((doc) => {
        const data = doc.data();
        const amount = parseFloat(data.totalPrice) || 0;
        const date = data.timestamp.toDate();
        const month = date.toLocaleString('default', { month: 'short' });

        // Calculate Revenue
        totalRevenue += amount;
        if (monthlyRevenue.hasOwnProperty(month)) {
            monthlyRevenue[month] += amount;
        }

        // Aggregate Customer Data
        if (!customerStats[data.customerName]) {
            customerStats[data.customerName] = { 
                spent: 0, 
                items: [], 
                status: data.paymentStatus 
            };
        }
        customerStats[data.customerName].spent += amount;
        customerStats[data.customerName].items.push(data.itemName);

        // Track Item Popularity
        itemPopularity[data.itemName] = (itemPopularity[data.itemName] || 0) + 1;
    });

    updateUI(totalRevenue, monthlyRevenue, customerStats, itemPopularity);
}

function updateUI(total, monthlyData, customers, items) {
    // Update Revenue Text
    document.getElementById('totalRevenueText').innerText = `₦${total.toLocaleString()}`;

    // Find Most Popular Item
    const topItem = Object.keys(items).reduce((a, b) => items[a] > items[b] ? a : b);
    document.getElementById('topItemText').innerText = topItem;

    // Update Revenue Chart
    revenueChart.data.datasets[0].data = Object.values(monthlyData);
    revenueChart.update();

    // Update Customer Table
    const tableBody = document.querySelector('tbody');
    tableBody.innerHTML = ''; // Clear placeholders

    Object.keys(customers).forEach(name => {
        const c = customers[name];
        const row = `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4 font-medium text-gray-800">${name}</td>
                <td class="p-4">${c.items.length} Items</td>
                <td class="p-4">₦${c.spent.toLocaleString()}</td>
                <td class="p-4">
                    <span class="${c.status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} px-3 py-1 rounded-full text-[10px] font-bold">
                        ${c.status.toUpperCase()}
                    </span>
                </td>
                <td class="p-4 text-center"><button class="text-purple-600">View</button></td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

// Initialize on load
window.onload = loadBusinessAnalytics;