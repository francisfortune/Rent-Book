// assets/js/ai-assistant.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getBusinessIdByEmail } from "./shared.js";
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
let openRouterApiKey = localStorage.getItem("openrouter_api_key") || "";
if (openRouterApiKey) {
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
    currentBusinessId = await getBusinessIdByEmail(user.email, user);
  } catch (err) {
    console.error("AI Assistant Auth Error:", err);
    if (err.message === "NO_BUSINESS" || err.message === "Business not found") {
      if (user && user.uid) {
        localStorage.removeItem(`businessId_${user.uid}`);
      }
      window.location.href = "setup.html";
    } else {
      appendSystemMessage("Error authenticating. Make sure your business profile is set up.");
    }
  }
});



/* =========================
   API KEY EVENTS
========================= */
if (saveKeyBtn) {
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      localStorage.removeItem("openrouter_api_key");
      openRouterApiKey = "";
      alert("API Key removed.");
    } else {
      localStorage.setItem("openrouter_api_key", key);
      openRouterApiKey = key;
      apiKeyInput.value = "••••••••••••••••";
      apiKeyBanner.classList.add("hidden");
      alert("OpenRouter API Key saved successfully! 🔑");
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

  // 5. Features / General Documentation
  if (/features|what\s+can\s+you\s+do|tracknrent\s+features|documentation/i.test(prompt)) {
    return `**Tracknrent Core Features**:\n\n` +
           `• **Smart Event Bookings**: Keep track of event schedules, client detail records, and payments. The system automatically monitors inventory shortages to prevent overbooking.\n` +
           `• **Live Inventory Catalog**: Real-time asset levels are auto-deducted during active rental periods and restored when marked returned.\n` +
           `• **Team Collaboration & Invites**: Add partner team members easily to help manage your business operations.\n` +
           `• **Reminders & Push Alerts**: Real-time push alerts via OneSignal notifications and automated overdue collection reminders.\n` +
           `• **Public Storefront Profile**: Share a customizable online catalog link with your clients.`;
  }

  // 6. Partner Invitation Guide
  if (/invite\s+partner|add\s+team|how\s+to\s+invite|partner\s+invitation|invite\s+steps/i.test(prompt)) {
    return `**Guide: How to Invite a Team Partner**:\n\n` +
           `1. Click on your **User Avatar** (top-right of any dashboard page) and choose **Settings**.\n` +
           `2. Scroll down to the **🤝 Invite Partner** card.\n` +
           `3. Enter your partner's **Email Address or Phone Number**.\n` +
           `4. Select their role (**Partner** for full edit permissions, or **Viewer** for read-only access).\n` +
           `5. Click **Invite Partner**.\n` +
           `6. The invited user can register or log in using that exact email or phone number to instantly join your business team.`;
  }

  // 7. Phone Number Invites Support
  if (/phone\s+invite|phone\s+invitation|support\s+phone|phone\s+number\s+invite/i.test(prompt)) {
    return `**Yes! Inviting team partners by phone number is fully supported.**\n\n` +
           `To invite by phone, type their clean phone number (e.g. \`+234801234567\`) in the partner input box on the Settings page.\n\n` +
           `The partner can then register or log in using Phone SMS OTP. Tracknrent will automatically match their phone number to your team invitation.`;
  }

  return "I didn't recognize that command in local mode. Try asking about 'features', 'how to invite partner', 'phone invites support', or 'list inventory'. Enter an OpenRouter API Key to enable general conversation.";
}

/* =========================
   OPENROUTER REQUEST WITH FALLBACKS & TOOLS
========================= */
const fallbackModels = [
  "openrouter/free",
  "meta-llama/llama-3-8b-instruct:free",
  "google/gemma-2-9b-it:free",
  "mistralai/mistral-7b-instruct:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free"
];

async function runOpenRouterWithTools(prompt) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const systemContent = `You are an AI business assistant for Tracknrent rental business owners.

Here is the Tracknrent features and documentation Knowledge Base:
1. Tracknrent Features:
   - Smart Event Bookings: Manage schedules, payments, and client profiles. Monitors inventory items for shortages or overbooking.
   - Live Inventory Catalog: Tracks asset counts in real-time, auto-deducting on bookings and restoring on returns.
   - Team Collaboration: Invite partner team members to collaborate on your business.
   - Reminders & Push Alerts: Sends push notifications and automated overdue alerts.
   - Public Storefront: Host an online page showcasing your catalog items with custom URLs.

2. Partner Invitation Steps:
   - Click User Avatar (top-right of page) -> Select "Settings".
   - Scroll to the "Invite Partner" section.
   - Enter their Email or Phone Number, choose their Role, and click "Invite Partner".
   - The partner accepts by signing up or logging in with that exact Email or Phone Number.

3. Phone Invites Support:
   - Yes! Phone invitations are fully supported.
   - You can enter their phone number (e.g. +2348037764808) in the Settings invitation form.
   - The invited partner signs up/logs in using Phone SMS OTP, and Tracknrent automatically matches the invite.

When the user asks you to perform database actions (view/edit inventory or bookings), ALWAYS use the provided function tool call rather than writing instructions. For informational queries, use this documentation. Be polite, concise, and helpful.`;
  
  const tools = [
    {
      type: "function",
      function: {
        name: "get_inventory",
        description: "Fetch all current items in the inventory, including quantities, price, and availability."
      }
    },
    {
      type: "function",
      function: {
        name: "adjust_inventory_count",
        description: "Modify the quantity of a specific inventory item. For example, to adjust count or decrease/increase stock.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the inventory item (e.g. Canopy, Chair, Table)"
            },
            adjustment: {
              type: "integer",
              description: "The net adjustment to apply (e.g. 5 to add 5 items, -3 to subtract 3 items)"
            }
          },
          required: ["name", "adjustment"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_bookings",
        description: "List recent client event bookings including date, client details, payment, status."
      }
    },
    {
      type: "function",
      function: {
        name: "cancel_booking",
        description: "Cancel a booking by its ID.",
        parameters: {
          type: "object",
          properties: {
            bookingId: {
              type: "string",
              description: "The unique ID of the booking to cancel."
            }
          },
          required: ["bookingId"]
        }
      }
    }
  ];

  for (const model of fallbackModels) {
    try {
      console.log(`Attempting OpenRouter request with model: ${model}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://rentbook.app",
          "X-Title": "Tracknrent AI Assistant"
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt }
          ],
          tools: tools
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      const message = data.choices?.[0]?.message;
      if (!message) {
        throw new Error("Empty response from OpenRouter model.");
      }

      // Check if the model triggered a tool call
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const toolName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch (e) {
          console.warn("Failed to parse tool arguments:", e);
        }

        let resultText = "";
        if (toolName === "get_inventory") {
          appendToolCard(`AI triggered Tool: Fetching inventory listing (model: ${model})...`);
          resultText = await getInventoryAction();
        } else if (toolName === "adjust_inventory_count") {
          appendToolCard(`AI triggered Tool: Adjusting '${args.name}' count by ${args.adjustment} (model: ${model})...`);
          resultText = await adjustInventoryAction(args.name, args.adjustment);
        } else if (toolName === "get_bookings") {
          appendToolCard(`AI triggered Tool: Fetching client bookings (model: ${model})...`);
          resultText = await getBookingsAction();
        } else if (toolName === "cancel_booking") {
          appendToolCard(`AI triggered Tool: Cancelling booking ID ${args.bookingId} (model: ${model})...`);
          resultText = await cancelBookingAction(args.bookingId);
        }

        // Send tool results back to OpenRouter to format final response
        const followUpResponse = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openRouterApiKey}`,
            "HTTP-Referer": "https://rentbook.app",
            "X-Title": "Tracknrent AI Assistant"
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: prompt },
              message, // Assistant message with tool_calls
              {
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolName,
                content: resultText
              }
            ]
          })
        });

        if (!followUpResponse.ok) {
          return resultText; // Return raw tool output if follow-up format fails
        }

        const followUpData = await followUpResponse.json();
        return followUpData.choices?.[0]?.message?.content || resultText;
      }

      return message.content || "No message content returned.";
    } catch (err) {
      console.warn(`Error using model ${model}:`, err.message);
      // Continue to next model in the fallback list
    }
  }

  throw new Error("All OpenRouter models failed to respond.");
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
  if (openRouterApiKey) {
    appendSystemMessage("Contacting OpenRouter neural engine...");
    try {
      aiResponse = await runOpenRouterWithTools(text);
    } catch (err) {
      appendSystemMessage(`OpenRouter Error: ${err.message}. Retrying locally...`);
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
