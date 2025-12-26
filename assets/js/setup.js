// setup.js
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Redirect to login if user not signed in
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "login.html";
  }
});

let currentStep = 1;
const totalSteps = 5;

// Navigation
document.addEventListener('DOMContentLoaded', () => {
  updateProgress();
  setupRadioButtons();
});

function setupRadioButtons() {
  const radioOptions = document.querySelectorAll('.radio-option');
  radioOptions.forEach(option => {
    option.addEventListener('click', function () {
      const radio = this.querySelector('input[type="radio"]');
      radio.checked = true;

      const name = radio.name;
      document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
        r.closest('.radio-option').classList.remove('selected');
      });

      this.classList.add('selected');
    });
  });
}

function nextStep() {
  if (!validateStep(currentStep)) return;

  if (currentStep < totalSteps) {
    document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.remove('active');
    currentStep++;
    document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.add('active');
    updateProgress();
    window.scrollTo(0, 0);
  }
}

function prevStep() {
  if (currentStep > 1) {
    document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.remove('active');
    currentStep--;
    document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.add('active');
    updateProgress();
    window.scrollTo(0, 0);
  }
}

function updateProgress() {
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
  document.getElementById('progressFill').style.width = progressPercentage + '%';

  document.querySelectorAll('.progress-step').forEach((step, index) => {
    const stepNumber = index + 1;
    if (stepNumber < currentStep) {
      step.classList.add('completed');
      step.classList.remove('active');
    } else if (stepNumber === currentStep) {
      step.classList.add('active');
      step.classList.remove('completed');
    } else {
      step.classList.remove('active', 'completed');
    }
  });
}

function validateStep(step) {
  const stepEl = document.querySelector(`.form-step[data-step="${step}"]`);
  let isValid = true;

  // Validate text / number inputs
  const textInputs = stepEl.querySelectorAll('input[type="text"][required], input[type="number"][required]');
  textInputs.forEach(input => {
    if (!input.value.trim()) {
      isValid = false;
      input.style.borderColor = '#f56565';
    } else {
      input.style.borderColor = '#e2e8f0';
    }
  });

  // Validate radio groups
  const radioGroups = [...new Set(Array.from(stepEl.querySelectorAll('input[type="radio"]')).map(r => r.name))];
  radioGroups.forEach(name => {
    const checked = stepEl.querySelector(`input[name="${name}"]:checked`);
    if (!checked) isValid = false;
  });

  if (!isValid) showToast('Please fill in all required fields');
  return isValid;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a202c;
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    font-weight: 500;
    z-index: 10000;
    animation: slideUp 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideDown 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function addInventoryItem() {
  const div = document.createElement("div");
  div.className = "inventory-item";
  div.innerHTML = `
    <hr style="margin:20px 0">
    <div class="form-group">
      <label>Item Name *</label>
      <input type="text" class="item-name" required>
    </div>
    <div class="form-group">
      <label>Quantity *</label>
      <input type="number" class="item-qty" min="1" required>
    </div>
    <div class="form-group">
      <label>Price</label>
      <input type="number" class="item-price" min="0">
    </div>
  `;
  document.getElementById("inventoryList").appendChild(div);
}

// Form submission
document.getElementById("setupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  btn.textContent = "Setting up...";

  try {
    // 1️⃣ Create Business
    const businessRef = await addDoc(collection(db, "businesses"), {
      name: document.getElementById("businessName").value,
      type: document.querySelector("input[name='businessType']:checked").value,
      city: document.getElementById("city").value,
      state: document.getElementById("state").value,
      rentalModel: document.querySelector("input[name='rentalModel']:checked").value,
      returnDuration: document.querySelector("input[name='returnDuration']:checked").value,
      ownerId: user.uid,
      createdAt: serverTimestamp()
    });

    const businessId = businessRef.id;

    // 2️⃣ Create Business Membership
    await addDoc(collection(db, "businessMembers"), {
      businessId,
      userId: user.uid,
      role: "owner",
      createdAt: serverTimestamp()
    });

    // 3️⃣ Add Inventory Items
    const items = document.querySelectorAll(".inventory-item");
    for (const item of items) {
      const name = item.querySelector(".item-name").value;
      const qty = Number(item.querySelector(".item-qty").value);
      const price = Number(item.querySelector(".item-price").value || 0);

      await addDoc(collection(db, "inventory"), {
        businessId,
        name,
        quantity: qty,
        price,
        createdAt: serverTimestamp()
      });
    }

    // 4️⃣ Show success screen
    document.querySelector('#setupForm').style.display = 'none';
    document.querySelector('.success-screen').classList.add('active');
    document.querySelector('.progress-container').style.display = 'none';

  } catch (err) {
    console.error(err);
    alert(err.message);
    btn.disabled = false;
    btn.textContent = "Complete Setup";
  }
});

// Go to dashboard
function goToDashboard() {
  showToast('Redirecting to dashboard...');
  setTimeout(() => {
    window.location.href = 'dashboard.html';
  }, 1000);
}
