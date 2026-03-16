import { auth, db } from "./firebase.js";
import {
collection,
query,
orderBy,
onSnapshot,
doc,
updateDoc,
getDocs,
where,
deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentRole="viewer"
let currentBusiness=null
let allBookings=[]


/* ---------------- STATUS SYSTEM ---------------- */

function getBookingStatus(b){

if(b.status==="returned") return "returned"

const today=new Date()
const returnDate=b.event?.returnDate ? new Date(b.event.returnDate) : null

if(returnDate && returnDate < today) return "overdue"

return "active"

}


/* ---------------- STATUS BADGE ---------------- */

function statusBadge(status){

const map={
active:"bg-green-100 text-green-700",
returned:"bg-gray-200 text-gray-700",
overdue:"bg-red-100 text-red-700"
}

return `
<span class="px-3 py-1 rounded-full text-xs font-bold ${map[status]}">
${status.toUpperCase()}
</span>
`

}


/* ---------------- TOTAL ---------------- */

function calcTotal(items){

let total=0

items.forEach(i=>{
total+=Number(i.price)*Number(i.qty)
})

return total

}


/* ---------------- OPEN BOOKING ---------------- */

window.openBooking=function(booking,id,businessId){

const modal=document.getElementById("bookingModal")
const content=document.getElementById("modalContent")

const total=calcTotal(booking.items)
const paid=booking.paid||0
const balance=total-paid
const status=getBookingStatus(booking)

content.innerHTML=`

<div class="space-y-6">

<!-- HEADER -->

<div class="bg-gradient-to-r from-purple-700 to-purple-500 text-white p-6 rounded-2xl shadow">

<div class="flex justify-between items-center">

<div>

<h2 class="text-2xl font-bold">${booking.client.name}</h2>

<p class="opacity-90">${booking.client.phone||""}</p>
<p class="opacity-80 text-sm">${booking.client.email||""}</p>

</div>

${statusBadge(status)}

</div>

</div>


<!-- EVENT -->

<div class="bg-purple-50 p-5 rounded-xl">

<h3 class="font-bold text-purple-700 mb-3">
Event Details
</h3>

<div class="grid grid-cols-2 gap-4 text-sm">

<div>
<label class="text-gray-500">Event Type</label>
<p class="font-semibold">${booking.event?.type||""}</p>
</div>

<div>
<label class="text-gray-500">Location</label>
<p class="font-semibold">${booking.event?.location||""}</p>
</div>

<div>
<label class="text-gray-500">Event Date</label>
<p class="font-semibold">${booking.event?.date||""}</p>
</div>

<div>
<label class="text-gray-500">Return Date</label>
<p class="font-semibold">${booking.event?.returnDate||""}</p>
</div>

</div>

</div>


<!-- ITEMS -->

<div class="bg-white border rounded-xl p-5 shadow-sm">

<h3 class="text-lg font-bold text-purple-700 mb-4">
Items
</h3>

${booking.items.map(i=>`

<div class="flex justify-between items-center border-b py-3">

<div>

<p class="font-bold text-lg text-gray-900">
${i.name}
</p>

<p class="text-sm text-gray-500 font-semibold">
Qty: ${i.qty}
</p>

</div>

<p class="font-extrabold text-purple-700 text-xl">
₦${Number(i.price)*Number(i.qty)}
</p>

</div>

`).join("")}

</div>


<!-- PAYMENT -->

<div class="bg-purple-50 p-5 rounded-xl">

<h3 class="font-bold text-purple-700 mb-3">
Payment
</h3>

<div class="space-y-1 text-sm">

<p>Total Amount: <b>₦${total}</b></p>
<p>Amount Paid: <b>₦${paid}</b></p>

<p class="font-bold text-purple-700 text-lg">
Balance: ₦${balance}
</p>

</div>

</div>


<!-- ACTIONS -->

<div class="space-y-3">

${currentRole!=="viewer" ? `

<button
class="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-bold"
onclick='openEditModal(${JSON.stringify(booking)},"${id}","${businessId}")'>

Edit Booking

</button>

`:``}


${currentRole!=="viewer" && status!=="returned" ? `

<button
class="w-full bg-purple-800 hover:bg-purple-900 text-white py-3 rounded-xl font-bold"
onclick='returnBooking("${id}","${businessId}")'>

Mark Returned

</button>

`:``}


${currentRole==="owner" ? `

<button
class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-bold"
onclick='deleteBooking("${id}","${businessId}")'>

Delete Booking

</button>

`:``}

</div>

</div>

`

modal.style.display="flex"

}


/* ---------------- EDIT MODAL ---------------- */

window.openEditModal=function(b,id,businessId){

const content=document.getElementById("modalContent")

content.innerHTML=`

<div class="space-y-4">

<h2 class="text-xl font-bold text-purple-700">
Edit Booking
</h2>

<input id="editName" value="${b.client.name}" class="border p-2 w-full rounded">

<input id="editPhone" value="${b.client.phone||""}" class="border p-2 w-full rounded">

<input id="editEmail" value="${b.client.email||""}" class="border p-2 w-full rounded">

<input id="editDate" type="date" value="${b.event?.date||""}" class="border p-2 w-full rounded">

<input id="editReturn" type="date" value="${b.event?.returnDate||""}" class="border p-2 w-full rounded">

<input id="editLocation" value="${b.event?.location||""}" class="border p-2 w-full rounded">


<div class="bg-purple-50 p-3 rounded-xl">

<h3 class="font-bold text-purple-700 mb-2">
Items
</h3>

<div id="itemsEditor">

${b.items.map(i=>`

<div class="grid grid-cols-3 gap-2 mb-2">

<input class="border p-2 rounded item-name" value="${i.name}">
<input class="border p-2 rounded item-price" type="number" value="${i.price}">
<input class="border p-2 rounded item-qty" type="number" value="${i.qty}">

</div>

`).join("")}

</div>

<button
class="mt-2 bg-purple-600 text-white px-4 py-2 rounded"
onclick="addItem()">

+ Add Item

</button>

</div>


<input
id="editPaid"
value="${b.paid||0}"
type="number"
placeholder="Enter amount customer has paid"
class="border-2 border-purple-200 focus:border-purple-500 p-3 w-full rounded-lg outline-none">


<textarea id="editNotes"
class="border p-2 w-full rounded"
placeholder="Additional notes about this booking">

${b.notes||""}

</textarea>


<button
class="w-full bg-purple-600 text-white py-3 rounded-xl font-bold"
onclick="saveEdit('${id}','${businessId}')">

Save Changes

</button>

</div>

`

}


/* ---------------- ADD ITEM ---------------- */

window.addItem=function(){

const editor=document.getElementById("itemsEditor")

editor.innerHTML+=`

<div class="grid grid-cols-3 gap-2 mb-2">

<input class="border p-2 rounded item-name" placeholder="Item name">

<input class="border p-2 rounded item-price" type="number" placeholder="Price">

<input class="border p-2 rounded item-qty" type="number" placeholder="Qty">

</div>

`

}


/* ---------------- SAVE EDIT ---------------- */

window.saveEdit=async function(id,businessId){

const items=[]

document.querySelectorAll("#itemsEditor > div").forEach(row=>{

items.push({

name:row.querySelector(".item-name").value,
price:Number(row.querySelector(".item-price").value),
qty:Number(row.querySelector(".item-qty").value)

})

})

await updateDoc(doc(db,"businesses",businessId,"bookings",id),{

"client.name":document.getElementById("editName").value,
"client.phone":document.getElementById("editPhone").value,
"client.email":document.getElementById("editEmail").value,

"event.date":document.getElementById("editDate").value,
"event.returnDate":document.getElementById("editReturn").value,
"event.location":document.getElementById("editLocation").value,

items:items,
paid:Number(document.getElementById("editPaid").value),
notes:document.getElementById("editNotes").value

})

closeModal()

}


/* ---------------- RETURN ---------------- */

window.returnBooking=async function(id,businessId){

await updateDoc(doc(db,"businesses",businessId,"bookings",id),{
status:"returned"
})

alert("Booking marked as returned")

}


/* ---------------- DELETE ---------------- */

window.deleteBooking=async function(id,businessId){

if(!confirm("Delete booking?")) return

await deleteDoc(doc(db,"businesses",businessId,"bookings",id))

closeModal()

}


/* ---------------- CLOSE MODAL ---------------- */

window.closeModal=function(){
document.getElementById("bookingModal").style.display="none"
}


/* ---------------- TABLE ---------------- */

function renderRow(b,id,businessId){

const status=getBookingStatus(b)

const highlight=status==="overdue"?"style='background:#fff5f5'":""

return`

<tr ${highlight}>

<td class="font-semibold">${b.client.name}</td>

<td>${b.event?.date||""}</td>

<td class="font-bold text-purple-700">
${b.items.length} items
</td>

<td>${statusBadge(status)}</td>

<td>

<button
class="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded font-bold"
onclick='openBooking(${JSON.stringify(b)},"${id}","${businessId}")'>

View

</button>

</td>

</tr>

`

}


/* ---------------- FILTER ---------------- */

const filterStatusEl=document.getElementById("filterStatus")
const filterDateEl=document.getElementById("filterDate")
const searchInputEl=document.getElementById("searchInput")

function renderFilteredBookings(){

const statusFilter=filterStatusEl.value
const dateFilter=filterDateEl.value
const search=searchInputEl.value.toLowerCase()

const table=document.getElementById("bookingsTable")

table.innerHTML=""

let filtered=allBookings.filter(b=>{

const status=getBookingStatus(b)

const matchStatus=!statusFilter || status===statusFilter
const matchDate=!dateFilter || b.event?.date===dateFilter
const matchSearch=!search || b.client.name.toLowerCase().includes(search)

return matchStatus && matchDate && matchSearch

})

if(!filtered.length){

table.innerHTML=`<tr><td colspan="5">No bookings</td></tr>`
return

}

filtered.forEach(b=>{
table.innerHTML+=renderRow(b,b.id,currentBusiness)
})

}


/* ---------------- LOAD BOOKINGS ---------------- */

onAuthStateChanged(auth,async user=>{

if(!user){
window.location.href="signup.html"
return
}

const memberSnap=await getDocs(
query(collection(db,"businessMembers"),where("email","==",user.email))
)

const member=memberSnap.docs[0].data()

currentRole=member.role
currentBusiness=member.businessId

const q=query(
collection(db,"businesses",currentBusiness,"bookings"),
orderBy("createdAt","desc")
)

onSnapshot(q,snap=>{

allBookings=[]

snap.forEach(docSnap=>{
allBookings.push({
id:docSnap.id,
...docSnap.data()
})
})

renderFilteredBookings()

})

})


filterStatusEl.addEventListener("change",renderFilteredBookings)
filterDateEl.addEventListener("change",renderFilteredBookings)
searchInputEl.addEventListener("input",renderFilteredBookings)