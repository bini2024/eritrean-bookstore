// --- NEW: Import functions directly ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- Firebase Configuration ---
// PASTE YOUR NEW CONFIG OBJECT HERE
const firebaseConfig = {
  apiKey: "AIzaSyBE3_ivAE2WFXQ3H8m1OWqM9APvRrI-Ac0",
  authDomain: "eritrean-bookstore.firebaseapp.com",
  projectId: "eritrean-bookstore",
  storageBucket: "eritrean-bookstore.firebasestorage.app",
  messagingSenderId: "645911365846",
  appId: "1:645911365846:web:5cd71799c6969bcaa1a177"
};
// --- Stripe Configuration ---
// ⬇️ 1. PASTE YOUR NEW $0.01 PRODUCT PAYMENT LINK HERE ⬇️
const STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/PASTE_YOUR_NEW_0.01_LINK_HERE";

// --- Initialize Firebase ---
let app, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (error) {
  console.error("CRITICAL: Firebase Initialization Error:", error);
  const body = document.querySelector('body');
  if (body) {
    body.innerHTML = `<p style="color: red; padding: 20px; font-family: sans-serif;"><b>Application Initialization Failed.</b><br>Could not initialize Firebase. Please check the browser console for details.</p>`;
  }
}

// --- Constants ---
const BOOKS_COLLECTION = 'books';
const DEBOUNCE_DELAY = 300;

// --- Global State ---
let allBooks = [];
let cart = Array.isArray(JSON.parse(localStorage.getItem('cart'))) ? JSON.parse(localStorage.getItem('cart')) : [];
let searchTimeout;

// --- DOM Element Caching ---
let booksGrid, searchInput, cartPanel, cartOverlay, cartItemsContainer, cartTotalEl, cartCountEl, checkoutBtnLink, cartToggleButton, cartCloseButton, booksErrorEl, currentYearEl;

function cacheDOMElements() {
  booksGrid = document.getElementById('booksGrid');
  searchInput = document.getElementById('searchInput');
  cartPanel = document.getElementById('cartPanel');
  cartOverlay = document.getElementById('cartOverlay');
  cartItemsContainer = document.getElementById('cartItems');
  cartTotalEl = document.getElementById('cartTotal');
  cartCountEl = document.getElementById('cart-count');
  checkoutBtnLink = document.getElementById('checkoutBtnLink');
  cartToggleButton = document.getElementById('cartToggleButton');
  cartCloseButton = document.getElementById('cartCloseButton');
  booksErrorEl = document.getElementById('booksError');
  currentYearEl = document.getElementById('currentYear');

  if (!booksGrid || !searchInput || !cartPanel || !checkoutBtnLink || !cartToggleButton) {
    console.error("Essential application DOM elements are missing. Functionality will be limited.");
  }
}

// --- Utility Functions ---

// ⬇️ 2. NEW HELPER FUNCTION ⬇️
function calculateCartTotal() {
  // Recalculates the total price from the cart array
  return cart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
}

function scrollToElement(id) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' });
  }
}

function toggleCart() {
  if (!cartPanel || !cartOverlay) {
    console.error("Cart panel or overlay element not found.");
    return;
  }
  const isOpen = cartPanel.classList.contains('open');
  cartPanel.classList.toggle('open');
  cartOverlay.classList.toggle('show');

  if (!isOpen) {
    renderCart(); // Re-render cart content when opening
  }
}

function saveCart() {
  try {
    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartCount();
    updateCheckoutLink(); // This will now also update the price
  } catch (e) {
    console.error("Error saving cart to localStorage:", e);
  }
}

function updateCartCount() {
  if (!cartCountEl) return;
  const count = Array.isArray(cart) ? cart.reduce((sum, item) => sum + (item?.quantity || 0), 0) : 0;
  cartCountEl.textContent = count;
}

// ⬇️ 3. UPDATED THIS FUNCTION ⬇️
function updateCheckoutLink() {
  if (!checkoutBtnLink) return;

  const total = calculateCartTotal(); // Get the current total

  if (total > 0 && cart.length > 0) {
    checkoutBtnLink.classList.remove('disabled');
    
    // Check if the user has provided a real link
    if (STRIPE_PAYMENT_LINK_URL && !STRIPE_PAYMENT_LINK_URL.includes("PASTE_YOUR_LINK_HERE")) {
      
      // --- THIS IS THE NEW LOGIC ---
      // We convert the price (e.g., $45.20) into cents (e.g., 4520)
      const totalInCents = Math.round(total * 100);
      
      // We pass the total in cents as the 'quantity' for our $0.01 product
      // ?quantity=4520 means 4520 x $0.01 = $45.20
      checkoutBtnLink.href = `${STRIPE_PAYMENT_LINK_URL}?quantity=${totalInCents}`;
      // --- END NEW LOGIC ---

    } else {
        checkoutBtnLink.href = '#'; // Prevent navigation if link is not set
        console.warn("Stripe Payment Link is not configured. Checkout will not work.");
    }
  } else {
    checkoutBtnLink.classList.add('disabled');
    checkoutBtnLink.href = '#';
  }
}

function debounce(func, delay) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(func, delay);
}

function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// --- Core Application Logic ---
async function fetchBooks() {
  if (!booksGrid || !booksErrorEl) {
    console.error("Missing booksGrid or booksErrorEl for fetchBooks.");
    return;
  }
  booksErrorEl.textContent = '';
  booksGrid.innerHTML = '<p>Loading products...</p>';
  try {
    if (!db) throw new Error("Firestore database is not initialized.");
    
    const booksCollection = collection(db, BOOKS_COLLECTION);
    const q = query(booksCollection, orderBy('title'));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      booksGrid.innerHTML = '<p>No products found in the collection.</p>';
      allBooks = [];
    } else {
      allBooks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      allBooks = allBooks.map(book => ({
        ...book,
        stock: typeof book.stock === 'number' && book.stock >= 0 ? book.stock : 0,
        price: typeof book.price === 'number' && book.price >= 0 ? book.price : 0.00
      }));
    }
    renderBooks(allBooks);
  } catch (error) {
    console.error("Error fetching products:", error);
    booksErrorEl.textContent = 'Failed to load products. Please check connection or Firestore configuration/rules.';
    booksGrid.innerHTML = '';
    allBooks = [];
  }
}

function renderBooks(bookList) {
  if (!booksGrid || !searchInput || !booksErrorEl) return;

  booksGrid.innerHTML = '';
  if (!Array.isArray(bookList) || bookList.length === 0) {
    const searchTerm = searchInput.value.trim().toLowerCase();
    if (searchTerm !== '') {
      booksGrid.innerHTML = '<p>No products match your search.</p>';
    } else {
      booksGrid.innerHTML = '<p>No products available at the moment.</p>';
    }
    return;
  }

  bookList.forEach(book => {
    const card = document.createElement('div');
    card.className = 'book-card';
    const title = escapeHTML(book.title || 'Untitled Product');
    const stock = book.stock;
    const price = book.price;
    const imgURL = escapeHTML(book.imgURL || 'https://via.placeholder.com/200x250?text=Product+Image');
    const isOutOfStock = stock <= 0;

    card.innerHTML = `
        <img src="${imgURL}" alt="Cover image for ${title}" loading="lazy">
        <div class="book-info">
          <div>
            <h3>${title}</h3>
            <p>$${price.toFixed(2)}</p>
            ${isOutOfStock ? '<p style="color: var(--error-color); font-weight: bold; font-size: 0.9rem;">Out of Stock</p>' : `<p>In Stock: ${stock}</p>`}
          </div>
          <div class="controls">
            <label for="qty-${escapeHTML(book.id)}" class="sr-only">Quantity for ${title}</label>
            <input type="number" min="1" max="${stock}" value="1" class="qty" id="qty-${escapeHTML(book.id)}" aria-label="Quantity for ${title}" ${isOutOfStock ? 'disabled' : ''}>
            <button class="add-btn" data-book-id="${escapeHTML(book.id)}" ${isOutOfStock ? 'disabled' : ''}>
              ${isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
            </button>
          </div>
        </div>`;
    booksGrid.appendChild(card);
  });
}

function handleSearch() {
  if (!searchInput) return;
  const query = searchInput.value.toLowerCase().trim();
  const filteredBooks = allBooks.filter(book =>
    book.title && typeof book.title === 'string' && book.title.toLowerCase().includes(query)
  );
  renderBooks(filteredBooks);
}

function addToCart(bookId, quantityToAdd) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book || typeof book.price !== 'number' || typeof book.stock !== 'number') {
    alert("Error: Could not add item. Product data is missing or invalid.");
    return;
  }
  if (book.stock <= 0) {
    alert(`"${book.title || 'This item'}" is out of stock.`);
    renderBooks(allBooks);
    return;
  }

  const quantity = parseInt(quantityToAdd, 10);
  if (isNaN(quantity) || quantity < 1) {
    alert("Please enter a valid positive quantity.");
    const qtyInput = document.getElementById(`qty-${escapeHTML(bookId)}`);
    if (qtyInput) qtyInput.value = '1';
    return;
  }

  const existingCartItemIndex = cart.findIndex(item => item.id === bookId);
  let currentCartQty = existingCartItemIndex > -1 ? cart[existingCartItemIndex].quantity : 0;
  const potentialNewTotalQty = currentCartQty + quantity;

  if (book.stock < potentialNewTotalQty) {
    alert(`Sorry, only ${book.stock} "${book.title || 'item'}" available. You have ${currentCartQty} in your cart.`);
    const qtyInput = document.getElementById(`qty-${escapeHTML(bookId)}`);
    if (qtyInput) qtyInput.value = Math.max(1, book.stock - currentCartQty);
    return;
  }
  if (existingCartItemIndex > -1) {
    cart[existingCartItemIndex].quantity = potentialNewTotalQty;
  } else {
    cart.push({
      id: bookId,
      title: book.title,
      price: book.price,
      quantity: quantity,
      imgURL: book.imgURL
    });
  }
  saveCart();
  
  const addButton = document.querySelector(`.add-btn[data-book-id="${escapeHTML(bookId)}"]`);
  if (addButton) {
    const originalText = addButton.textContent;
    addButton.textContent = 'Added!';
    addButton.disabled = true;
    setTimeout(() => {
      addButton.textContent = originalText;
      const updatedItemInCart = cart.find(item => item.id === bookId);
      const currentStock = allBooks.find(b => b.id === bookId)?.stock ?? 0;
      if (!updatedItemInCart || updatedItemInCart.quantity < currentStock) {
          addButton.disabled = false;
      }
    }, 1500);
  }
}

function renderCart() {
  if (!cartItemsContainer || !cartTotalEl) return;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = '<p>Your cart is empty.</p>';
    cartTotalEl.textContent = '0.00';
    return;
  }

  cartItemsContainer.innerHTML = '';
  const total = calculateCartTotal(); // Use our new function
  
  cart.forEach(item => {
    const itemTotal = (item.price || 0) * (item.quantity || 0);
    const bookInStore = allBooks.find(b => b.id === item.id);
    const maxStock = bookInStore ? bookInStore.stock : item.quantity;

    const itemEl = document.createElement('div');
    itemEl.className = 'cart-item';
    itemEl.innerHTML = `
        <img src="${escapeHTML(item.imgURL || 'https://via.placeholder.com/50x60')}" alt="${escapeHTML(item.title)}">
        <div class="item-info">
          <strong>${escapeHTML(item.title)}</strong>
          <span>$${(item.price || 0).toFixed(2)} x ${item.quantity} = $${itemTotal.toFixed(2)}</span>
        </div>
        <div class="item-controls">
          <button class="qty-btn" data-id="${escapeHTML(item.id)}" data-change="-1" ${item.quantity <= 1 ? 'disabled' : ''}>-</button>
          <span class="item-qty">${item.quantity}</span>
          <button class="qty-btn" data-id="${escapeHTML(item.id)}" data-change="1" ${item.quantity >= maxStock ? 'disabled' : ''}>+</button>
          <button class="remove-btn" data-id="${escapeHTML(item.id)}">&times;</button>
        </div>
    `;
    cartItemsContainer.appendChild(itemEl);
  });
  cartTotalEl.textContent = total.toFixed(2);
}

function updateCartItemQuantity(bookId, change) {
  const itemIndex = cart.findIndex(item => item.id === bookId);
  if (itemIndex === -1) return;

  const bookInStore = allBooks.find(b => b.id === bookId);
  const maxStock = bookInStore ? bookInStore.stock : cart[itemIndex].quantity;
  const newQuantity = cart[itemIndex].quantity + change;

  if (newQuantity > 0 && newQuantity <= maxStock) {
    cart[itemIndex].quantity = newQuantity;
  } else if (newQuantity <= 0) {
    cart.splice(itemIndex, 1);
  }
  saveCart();
  renderCart(); // Re-render to show changes
  updateCheckoutLink(); // ⬇️ 4. ADDED THIS CALL ⬇️
}

function removeFromCart(bookId) {
  cart = cart.filter(item => item.id !== bookId);
  saveCart();
  renderCart();
  updateCheckoutLink(); // ⬇️ 5. ADDED THIS CALL ⬇️
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Search input with debounce
  searchInput.addEventListener('input', () => debounce(handleSearch, DEBOUNCE_DELAY));

  // Add to cart (delegated)
  booksGrid.addEventListener('click', (e) => {
    if (e.target.classList.contains('add-btn')) {
      const button = e.target;
      const bookId = button.dataset.bookId;
      const card = button.closest('.book-card');
      const qtyInput = card.querySelector('.qty');
      if (bookId && qtyInput) {
        addToCart(bookId, qtyInput.value);
      }
    }
  });

  // Cart toggling
  cartToggleButton.addEventListener('click', toggleCart);
  cartCloseButton.addEventListener('click', toggleCart);
  cartOverlay.addEventListener('click', toggleCart);

  // Cart item controls (delegated)
  cartItemsContainer.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('qty-btn')) {
      const bookId = target.dataset.id;
      const change = parseInt(target.dataset.change, 10);
      updateCartItemQuantity(bookId, change);
    } else if (target.classList.contains('remove-btn')) {
      const bookId = target.dataset.id;
      removeFromCart(bookId);
    }
  });
}

// --- Application Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  cacheDOMElements();
  if (currentYearEl) {
    currentYearEl.textContent = new Date().getFullYear();
  }
  
  if (STRIPE_PAYMENT_LINK_URL.includes("PASTE_YOUR_LINK_HERE")) {
    console.error("CRITICAL: You must set your Stripe Payment Link in app.js for checkout to work.");
    if (checkoutBtnLink) {
      checkoutBtnLink.addEventListener('click', (e) => {
        e.preventDefault();
        alert("Checkout is not configured. Please contact support.");
      });
    }
  }

  if (db) {
    fetchBooks();
  }
  
  setupEventListeners();
  updateCartCount();
  updateCheckoutLink(); // Initial check for the checkout link state
});
