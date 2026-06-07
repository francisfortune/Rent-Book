// assets/js/ai-assistant.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  query,
  where,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { cancelBooking } from "./services/bookingService.js";

let currentBusinessId = null;
let currentUserName = "";

const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const apiKeyBanner = document.getElementById("apiKeyBanner");
const chatMessages = document.getElementById("chatMessages");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// Initialize API Key from LocalStorage
let geminiApiKey = localStorage.getItem("gemini_api_key") || "";
if (geminiApiKey) {
  apiKeyInput.value = "••••••••••••••••";
  apiKeyBanner.classList.add("hidden"); // Hide banner if already set
}

/* =========================
   AUTH STATE LOOKUP
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signup.html";
    return;
  }

  currentUserName = user.displayName || user.email || "User";
  try {
    currentBusinessId = await getBusinessIdByUid(user.uid);
  } catch (err) {
    console.error("AI Assistant Auth Error:", err);
    appendSystemMessage("Error authenticating. Make sure your business profile is set up.");
  }
});

async function getBusinessIdByUid(uid) {
  const cacheKey = `businessId_${uid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  const q = query(
    collection(db, "businessMembers"),
    where("uid", "==", uid)
  );
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("NO_BUSINESS");
  const businessId = snap.docs[0].data().businessId;
  localStorage.setItem(cacheKey, businessId);
  return businessId;
}

/* =========================
   API KEY EVENTS
========================= */
if (saveKeyBtn) {
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      localStorage.removeItem("gemini_api_key");
      geminiApiKey = "";
      alert("API Key removed.");
    } else {
      localStorage.setItem("gemini_api_key", key);
      geminiApiKey = key;
      apiKeyInput.value = "••••••••••••••••";
      apiKeyBanner.classList.add("hidden");
      alert("Gemini API Key saved successfully! 🔑");
    }
  });
}

/* =========================
   CHAT MESSAGES RENDERING
========================= */
function appendUserMessage(text) {
  const msg = document.createElement("div");
  msg.className = "message user";
  msg.textContent = text;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendAiMessage(text) {
  const msg = document.createElement("div");
  msg.className = "message ai";
  msg.innerHTML = text.replace(/\n/g, "<br>");
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
  const msg = document.createElement("div");
  msg.className = "message system";
  msg.textContent = text;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendToolCard(message) {
  const card = document.createElement("div");
  card.className = "tool-card";
  card.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">build</span><span>${message}</span>`;
  chatMessages.appendChild(card);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* =========================
   BUSINESS DATABASE ACTIONS
========================= */
async function getInventoryAction() {
  if (!currentBusinessId) return "Error: No business profile loaded.";
  
  const snap = await getDocs(collection(db, "businesses", currentBusinessId, "inventory"));
  if (snap.empty) return "Inventory is currently empty.";

  let response = "Here is the current inventory catalog:\n";
  snap.docs.forEach(docSnap => {
    const item = docSnap.data();
    response += `• **${item.name}**: Total: ${item.totalQuantity}, Available: ${item.availableQuantity}, Price: ₦${item.price.toLocaleString()}\n`;
  });
  return response;
}

async function adjustInventoryAction(name, adjustment) {
  if (!currentBusinessId) return "Error: No business profile loaded.";
  
  const invColl = collection(db, "businesses", currentBusinessId, "inventory");
  const snap = await getDocs(invColl);
  const match = snap.docs.find(d => d.data().name.toLowerCase() === name.trim().toLowerCase());

  if (!match) {
    return `Error: Item '${name}' was not found in your inventory. Make sure the spelling is exact.`;
  }

  const itemData = match.data();
  const newTotal = Math.max(0, (itemData.totalQuantity || 0) + adjustment);
  const newAvailable = Math.max(0, (itemData.availableQuantity || 0) + adjustment);

  await updateDoc(match.ref, {
    totalQuantity: newTotal,
    availableQuantity: newAvailable,
    updatedAt: serverTimestamp()
  });

  // Log inventory notification
  await addDoc(collection(db, "businesses", currentBusinessId, "notifications"), {
    message: `🤖 AI Assistant adjusted stock for '${itemData.name}' by ${adjustment}.`,
    type: "inventory",
    createdAt: serverTimestamp(),
    readBy: []
  });

  return `Successfully updated '${itemData.name}' stock by ${adjustment}. New total quantity: ${newTotal}.`;
}

async function getBookingsAction() {
  if (!currentBusinessId) return "Error: No business profile loaded.";
  
  const snap = await getDocs(collection(db, "businesses", currentBusinessId, "bookings"));
  if (snap.empty) return "No bookings found.";

  let response = "Here are the recent client bookings:\n";
  snap.docs.slice(0, 10).forEach(docSnap => {
    const b = docSnap.data();
    const balance = (b.payment?.total || 0) - (b.payment?.paid || 0);
    response += `• **ID**: ${docSnap.id} | Client: ${b.client?.name} | Event: ${b.event?.type} on ${b.event?.date} | Status: ${b.status} | Balance Due: ₦${balance.toLocaleString()}\n`;
  });
  return response;
}

async function cancelBookingAction(bookingId) {
  if (!currentBusinessId) return "Error: No business profile loaded.";
  
  try {
    await cancelBooking(currentBusinessId, bookingId, "Cancelled by AI Assistant command");
    return `Successfully cancelled booking ID ${bookingId} and returned reserved items to inventory.`;
  } catch (err) {
    return `Error cancelling booking: ${err.message}`;
  }
}

/* =========================
   LOCAL REGEX NLP ROUTER
========================= */
async function runLocalNlp(prompt) {
  appendSystemMessage("Offline/Local NLP mode: Executing command...");
  
  // 1. Get Inventory
  if (/list\s+inventory|show\s+inventory|get\s+inventory|view\s+inventory/i.test(prompt)) {
    appendToolCard("Fetching inventory listing...");
    const res = await getInventoryAction();
    return res;
  }

  // 2. Adjust Inventory
  // Match e.g. "Adjust Canopy by -2" or "adjust chairs by 5"
  const adjustMatch = prompt.match(/adjust\s+([\w\s]+?)\s+by\s+(-?\d+)/i);
  if (adjustMatch) {
    const itemName = adjustMatch[1].trim();
    const adjustment = parseInt(adjustMatch[2], 10);
    appendToolCard(`Adjusting '${itemName}' count by ${adjustment}...`);
    const res = await adjustInventoryAction(itemName, adjustment);
    return res;
  }

  // 3. Get Bookings
  if (/list\s+bookings|show\s+bookings|get\s+bookings|view\s+bookings/i.test(prompt)) {
    appendToolCard("Fetching client bookings...");
    const res = await getBookingsAction();
    return res;
  }

  // 4. Cancel Booking
  const cancelMatch = prompt.match(/cancel\s+booking\s+(\w+)/i);
  if (cancelMatch) {
    const bId = cancelMatch[1].trim();
    appendToolCard(`Cancelling booking ID ${bId}...`);
    const res = await cancelBookingAction(bId);
    return res;
  }

  return "I didn't recognize that command in local mode. Please use standard phrases like 'list inventory', 'adjust Canopy by 5', or input a Gemini API Key to enable general conversation.";
}

/* =========================
   GEMINI API REQUEST WITH TOOLS
========================= */
async function runGeminiWithTools(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
  
  // Define tools schemas
  const tools = [{
    functionDeclarations: [
      {
        name: "get_inventory",
        description: "Fetch all current items in the inventory, including quantities, price, and availability."
      },
      {
        name: "adjust_inventory_count",
        description: "Modify the quantity of a specific inventory item. For example, to adjust count or decrease/increase stock.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: {
              type: "STRING",
              description: "The name of the inventory item (e.g. Canopy, Chair, Table)"
            },
            adjustment: {
              type: "INTEGER",
              description: "The net adjustment to apply (e.g. 5 to add 5 items, -3 to subtract 3 items)"
            }
          },
          required: ["name", "adjustment"]
        }
      },
      {
        name: "get_bookings",
        description: "List recent client event bookings including date, client details, payment, status."
      },
      {
        name: "cancel_booking",
        description: "Cancel a booking by its ID.",
        parameters: {
          type: "OBJECT",
          properties: {
            bookingId: {
              type: "STRING",
              description: "The unique ID of the booking to cancel."
            }
          },
          required: ["bookingId"]
        }
      }
    ]
  }];

  const systemInstruction = {
    parts: [{
      text: "You are an AI business assistant for Tracknrent rental business owners. You can read inventory, update stock counts, view bookings, and cancel them. When the user asks you to perform database actions, ALWAYS use the provided function tool call rather than writing instructions. Be polite, concise, and helpful."
    }]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: tools,
        systemInstruction: systemInstruction
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    // Check if the model wants to call a tool
    if (part?.functionCall) {
      const call = part.functionCall;
      const toolName = call.name;
      const args = call.args || {};

      let resultText = "";
      if (toolName === "get_inventory") {
        appendToolCard("AI triggered Tool: Fetching inventory listing...");
        resultText = await getInventoryAction();
      } else if (toolName === "adjust_inventory_count") {
        appendToolCard(`AI triggered Tool: Adjusting '${args.name}' count by ${args.adjustment}...`);
        resultText = await adjustInventoryAction(args.name, args.adjustment);
      } else if (toolName === "get_bookings") {
        appendToolCard("AI triggered Tool: Fetching client bookings...");
        resultText = await getBookingsAction();
      } else if (toolName === "cancel_booking") {
        appendToolCard(`AI triggered Tool: Cancelling booking ID ${args.bookingId}...`);
        resultText = await cancelBookingAction(args.bookingId);
      }

      // Feed function result back to model to get final text response
      const followUpResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: prompt }] },
            candidate.content, // Model's function call message
            {
              role: "function",
              parts: [{
                functionResponse: {
                  name: toolName,
                  response: { result: resultText }
                }
              }]
            }
          ],
          tools: tools,
          systemInstruction: systemInstruction
        })
      });

      const followUpData = await followUpResponse.json();
      const finalCandidate = followUpData.candidates?.[0];
      return finalCandidate?.content?.parts?.[0]?.text || resultText;
    }

    return part?.text || "I was unable to complete this query.";

  } catch (err) {
    console.error("Gemini API Error:", err);
    return `Failed to contact Gemini: ${err.message}. Running query in local mode instead...`;
  }
}

/* =========================
   SEND BUTTON CLICKS
========================= */
async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  appendUserMessage(text);
  userInput.value = "";

  let aiResponse = "";
  if (geminiApiKey) {
    appendSystemMessage("Contacting Gemini neural engine...");
    aiResponse = await runGeminiWithTools(text);
    
    // Check if Gemini failed, fall back to local NLP
    if (aiResponse.includes("Failed to contact Gemini")) {
      aiResponse = await runLocalNlp(text);
    }
  } else {
    aiResponse = await runLocalNlp(text);
  }

  appendAiMessage(aiResponse);
}

if (sendBtn && userInput) {
  sendBtn.addEventListener("click", handleSend);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });
}
