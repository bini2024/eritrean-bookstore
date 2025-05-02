 // --- Firebase Configuration ---
    // WARNING: Exposing API keys client-side is common in Firebase web apps,
    // but ensure your Firestore security rules are properly configured to protect your data.
    const firebaseConfig = {
        apiKey: "AIzaSyBE3_ivAE2WFXQ3H8m1OWqM9APvRrI-Ac0", // Replace if necessary, keep secure
        authDomain: "eritrean-bookstore.firebaseapp.com",
        projectId: "eritrean-bookstore",
        // Corrected default storage bucket format (usually project-id.appspot.com)
        storageBucket: "eritrean-bookstore.appspot.com", // Verify this is correct for your project
        messagingSenderId: "645911365846",
        appId: "1:645911365846:web:5cd71799c6969bcaa1a177"
    };

    // --- Initialize Firebase (v8 Compat SDKs are expected) ---
    // Make sure you have included the necessary v8 compat scripts in the <head>:
    // <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
    // <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
    // <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-functions-compat.js"></script> // Needed if using callable functions, optional for HTTP
    // Also include Stripe.js: <script src="https://js.stripe.com/v3/"></script>

    let app, db;
    try {
        if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function') {
             throw new Error("Firebase SDK not loaded. Ensure compat scripts are included in <head>.");
        }
        app = firebase.initializeApp(firebaseConfig);
        db = firebase.firestore(); // Use v8 compat syntax

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        // Display a critical error to the user if Firebase fails to load
        const body = document.querySelector('body');
        if (body) {
            body.innerHTML = `<p style="color: red; padding: 20px;">Error initializing the application. Please check the console or contact support.</p>`;
        }
    }

    // --- Constants ---
    const BOOKS_COLLECTION = 'books';
    const ORDERS_COLLECTION = 'orders'; // Used server-side in Cloud Function
    // const ORDER_STATUS_PENDING = 'pending'; // Defined but not used client-side in this version
    const DEBOUNCE_DELAY = 300; // ms for search debounce

    // --- Global State ---
    let allBooks = [];
    // Initialize cart from local storage, ensure it's an array
    let cart = Array.isArray(JSON.parse(localStorage.getItem('cart'))) ? JSON.parse(localStorage.getItem('cart')) : [];
    let searchTimeout;

    // --- Stripe Initialization ---
    // !!! IMPORTANT: Replace with your ACTUAL Stripe Publishable Key !!!
    const stripePublishableKey = 'pk_test_YOUR_PUBLISHABLE_KEY'; // e.g., pk_test_51... or pk_live_51...
    if (!stripePublishableKey || !stripePublishableKey.startsWith('pk_')) {
        console.error("CRITICAL: Stripe Publishable Key is missing or invalid!");
        // Optionally display an error to the user
    }
    const stripe = Stripe(stripePublishableKey);
    let paymentIntentClientSecret = null; // Holds the secret from the Cloud Function
    let elements; // Holds the Stripe Elements instance

    // --- DOM Element Caching ---
    // Cache elements only after DOM is loaded
    let booksGrid, searchInput, cartPanel, cartOverlay, cartItemsContainer, cartTotalEl, cartCountEl, checkoutBtn, orderStatusEl, cartToggleButton, cartCloseButton, booksErrorEl, currentYearEl, paymentForm, paymentElement, paymentMessage, paymentSubmitButton;

    function cacheDOMElements() {
        booksGrid = document.getElementById('booksGrid');
        searchInput = document.getElementById('searchInput');
        cartPanel = document.getElementById('cartPanel');
        cartOverlay = document.getElementById('cartOverlay');
        cartItemsContainer = document.getElementById('cartItems');
        cartTotalEl = document.getElementById('cartTotal');
        cartCountEl = document.getElementById('cart-count');
        checkoutBtn = document.getElementById('checkoutBtn');
        orderStatusEl = document.getElementById('orderStatus');
        cartToggleButton = document.getElementById('cartToggleButton');
        cartCloseButton = document.getElementById('cartCloseButton');
        booksErrorEl = document.getElementById('booksError');
        currentYearEl = document.getElementById('currentYear');
        paymentForm = document.getElementById('payment-form');
        paymentElement = document.getElementById('payment-element');
        paymentMessage = document.getElementById('payment-message');
        // Get the submit button *inside* the form, check if form exists first
        paymentSubmitButton = paymentForm ? paymentForm.querySelector('button[type="submit"]') : null;

        // Basic check for critical elements needed for core functionality
        if (!booksGrid || !searchInput || !cartPanel || !cartItemsContainer || !cartCountEl || !checkoutBtn || !cartToggleButton) {
             console.error("Essential DOM elements are missing. Check your HTML structure.");
             // Optional: Display an error message on the page
        }
    }

    // --- Utility Functions ---
    function scrollToElement(id) {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    }

    function toggleCart() {
        if (!cartPanel || !cartOverlay) return; // Check if elements exist
        const isOpen = cartPanel.classList.contains('open');
        cartPanel.classList.toggle('open');
        cartOverlay.classList.toggle('show');
        if (!isOpen) {
            renderCart(); // Render cart content only when opening
            // Hide payment form and clear messages when opening cart initially
            if (paymentForm) paymentForm.style.display = 'none';
            if (paymentMessage) paymentMessage.textContent = '';
            if (orderStatusEl) orderStatusEl.textContent = ''; // Clear general status too
        }
    }

    function saveCart() {
        try {
            localStorage.setItem('cart', JSON.stringify(cart));
            updateCartCount();
            // Disable checkout button if cart is empty (check if button exists)
            if (checkoutBtn) {
                checkoutBtn.disabled = cart.length === 0;
            }
        } catch (e) {
            console.error("Error saving cart to localStorage:", e);
            // Handle potential storage errors (e.g., quota exceeded)
        }
    }

    function updateCartCount() {
        if (!cartCountEl) return; // Check if element exists
        // Ensure cart is an array before reducing
        const count = Array.isArray(cart) ? cart.reduce((sum, item) => sum + (item.quantity || 0), 0) : 0;
        cartCountEl.textContent = count;
    }

    // Debounce function
    function debounce(func, delay) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(func, delay);
    }

    // Helper to prevent XSS by creating text nodes
    function escapeHTML(str) {
        if (typeof str !== 'string') return str; // Return non-strings as is
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // --- Core Application Logic ---

    // Fetch & Render Books
    async function fetchBooks() {
        if (!booksGrid || !booksErrorEl) return; // Check elements

        booksErrorEl.textContent = '';
        booksGrid.innerHTML = '<p>Loading books...</p>'; // Loading indicator

        try {
            if (!db) throw new Error("Firestore database is not initialized.");

            // Fetch books (consider adding .orderBy() if needed)
            const snapshot = await db.collection(BOOKS_COLLECTION).get(); // v8 get()

            if (snapshot.empty) {
                booksGrid.innerHTML = '<p>No books found in the collection.</p>';
                allBooks = [];
                renderBooks(allBooks); // Render empty state
                return;
            }

            // Map Firestore docs to book objects
            allBooks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderBooks(allBooks);

        } catch (error) {
            console.error("Error fetching books:", error);
            booksErrorEl.textContent = 'Failed to load books. Please check connection or Firestore configuration/rules.';
            booksGrid.innerHTML = ''; // Clear loading message on error
            allBooks = []; // Ensure allBooks is empty on error
        }
    }

    function renderBooks(bookList) {
         if (!booksGrid || !searchInput || !booksErrorEl) return; // Check elements

        booksGrid.innerHTML = ''; // Clear current grid content

        if (!Array.isArray(bookList)) {
            booksGrid.innerHTML = '<p>Error: Book data format incorrect.</p>';
            console.error("renderBooks received invalid data:", bookList);
            return;
        }

        const searchTerm = searchInput.value.trim();

        // Display appropriate message based on context
        if (bookList.length === 0) {
             if (searchTerm !== '') {
                 booksGrid.innerHTML = '<p>No books match your search.</p>';
             } else if (allBooks.length === 0 && booksErrorEl.textContent === '') {
                 // Initial fetch successful but no books in DB
                  booksGrid.innerHTML = '<p>No books available at the moment.</p>';
             } else if (booksErrorEl.textContent !== '') {
                 // Error message is already displayed by fetchBooks
                 booksGrid.innerHTML = ''; // Keep grid clear if fetch failed
             }
             else {
                  // Should not happen if fetch succeeded and search is empty, but fallback
                  booksGrid.innerHTML = '<p>No books to display.</p>';
             }
        } else {
            bookList.forEach(book => {
                const card = document.createElement('div');
                card.className = 'book-card';

                // Validate data and provide defaults
                const title = escapeHTML(book.title || 'Untitled Book');
                const stock = typeof book.stock === 'number' && book.stock >= 0 ? book.stock : 0;
                const price = typeof book.price === 'number' && book.price >= 0 ? book.price : 0.00;
                const imgURL = book.imgURL || 'placeholder.jpg'; // Use a placeholder image if URL is missing
                const isOutOfStock = stock <= 0;

                card.innerHTML = `
                    <img src="${imgURL}" alt="${title}" loading="lazy">
                    <div class="book-info">
                        <div>
                            <h3>${title}</h3>
                            <p>$${price.toFixed(2)}</p>
                        </div>
                        <div class="controls">
                            <label for="qty-${book.id}" class="sr-only">Quantity for ${title}</label>
                            <input type="number" min="1" max="${stock}" value="1" class="qty" id="qty-${book.id}" aria-label="Quantity for ${title}" ${isOutOfStock ? 'disabled' : ''}>
                            <button class="add-btn" data-book-id="${book.id}" ${isOutOfStock ? 'disabled' : ''}>
                                ${isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
                            </button>
                        </div>
                    </div>`;

                const addButton = card.querySelector('.add-btn');
                const qtyInput = card.querySelector(`#qty-${book.id}`);

                if (addButton && qtyInput && !isOutOfStock) {
                    addButton.addEventListener('click', () => {
                        const quantity = parseInt(qtyInput.value, 10); // Use radix 10

                        if (isNaN(quantity) || quantity < 1) {
                            alert('Please enter a valid positive quantity.');
                            qtyInput.value = '1'; // Reset input
                            return;
                        }
                        if (quantity > stock) {
                            alert(`Cannot add ${quantity}. Only ${stock} "${book.title || 'item'}" available.`);
                             qtyInput.value = stock > 0 ? stock : '1'; // Reset to max available or 1
                            return;
                        }

                        addToCart(book.id, quantity);

                        // Provide visual feedback
                        addButton.textContent = 'Added!';
                        addButton.disabled = true;
                        setTimeout(() => {
                            addButton.textContent = 'Add to Cart';
                            addButton.disabled = false;
                            qtyInput.value = '1'; // Reset quantity input after adding
                        }, 1000); // Show 'Added!' for 1 second
                    });
                }
                booksGrid.appendChild(card);
            });
        }
    }

    // Search functionality (triggered by event listener)
    function handleSearch() {
        if (!searchInput) return;
        const query = searchInput.value.toLowerCase().trim();
        // Filter the globally stored allBooks array
        const filteredBooks = allBooks.filter(book =>
            book.title && typeof book.title === 'string' && book.title.toLowerCase().includes(query)
        );
        renderBooks(filteredBooks);
    }

    // Cart Functions
    function addToCart(bookId, quantityToAdd) {
        const book = allBooks.find(b => b.id === bookId);

        // Validate book data before adding
        if (!book || typeof book.price !== 'number' || typeof book.stock !== 'number' || book.stock <= 0) {
            console.error("Attempted to add invalid or out-of-stock book:", bookId, book);
            alert("Error: Could not add item. Book data is missing or it's out of stock.");
            return;
        }
         if (typeof quantityToAdd !== 'number' || quantityToAdd < 1) {
             console.warn("Attempted to add invalid quantity:", quantityToAdd);
              alert("Please enter a valid quantity.");
             return;
         }

        const existingCartItemIndex = cart.findIndex(item => item.id === bookId);
        let currentCartQty = 0;

        if (existingCartItemIndex > -1) {
            currentCartQty = cart[existingCartItemIndex].quantity;
        }

        const potentialNewTotalQty = currentCartQty + quantityToAdd;

        // Client-side stock check (UX only, real check is server-side)
        if (book.stock < potentialNewTotalQty) {
            alert(`Sorry, only ${book.stock} "${book.title || 'item'}" available in total. You already have ${currentCartQty} in your cart.`);
            // Optionally, adjust quantityToAdd to max available
            // quantityToAdd = book.stock - currentCartQty;
            // if (quantityToAdd <= 0) return; // Don't add if none can be added
            return; // Or simply prevent adding more than available
        }

        if (existingCartItemIndex > -1) {
            cart[existingCartItemIndex].quantity = potentialNewTotalQty;
        } else {
            // Add new item. Store necessary info for display and BACKEND VERIFICATION.
            // Price stored here MUST be re-verified server-side.
            cart.push({
                id: bookId,
                title: book.title,
                price: book.price, // Store price, BUT VALIDATE SERVER-SIDE at checkout
                quantity: quantityToAdd,
                imgURL: book.imgURL // Store image URL for cart display
            });
        }

        saveCart();
        // If cart panel is open, re-render it to show the update immediately
        if (cartPanel && cartPanel.classList.contains('open')) {
            renderCart();
        }
    }

    function renderCart() {
         if (!cartItemsContainer || !cartTotalEl || !checkoutBtn || !orderStatusEl) return; // Check elements

        cartItemsContainer.innerHTML = ''; // Clear current cart content
        let currentTotal = 0;
        orderStatusEl.textContent = ''; // Clear previous order status message

        // Filter out invalid items just in case they slipped through
        cart = cart.filter(item => item && item.id && typeof item.quantity === 'number' && item.quantity > 0 && typeof item.price === 'number');

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p>Your cart is empty.</p>';
            cartTotalEl.textContent = '0.00';
            checkoutBtn.disabled = true;
            // Hide payment form if cart becomes empty
            if (paymentForm) paymentForm.style.display = 'none';
            if (paymentMessage) paymentMessage.textContent = '';
            saveCart(); // Ensure empty cart is saved if filtering removed everything
            return;
        }

        cart.forEach(item => {
            const price = item.price; // Already validated as number by filter
            const itemTotal = price * item.quantity;
            currentTotal += itemTotal;
            // Find the book in the fetched list to check current stock (for display warning)
            const bookInStockData = allBooks.find(b => b.id === item.id);
            const currentStock = bookInStockData?.stock ?? 0; // Default to 0 if book not found or stock missing
            const title = escapeHTML(item.title || 'Untitled Item');

            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `
                <img src="${item.imgURL || 'placeholder.jpg'}" alt="${title}" style="width: 40px; height: auto; vertical-align: middle; margin-right: 8px; border-radius: 4px;">
                <div class="item-info">
                    <strong>${title}</strong>
                    <span>$${price.toFixed(2)} x ${item.quantity} = $${itemTotal.toFixed(2)}</span>
                    ${item.quantity > currentStock ? `<br><small style="color:red; font-weight:bold;">Warning: Quantity exceeds available stock (${currentStock})!</small>` : ''}
                </div>
                <div class="item-controls">
                    <button class="qty-btn decrease-qty" data-id="${item.id}" data-qty="${item.quantity - 1}" aria-label="Decrease quantity of ${title}">-</button>
                    <span class="item-qty" aria-live="polite">${item.quantity}</span>
                    <button class="qty-btn increase-qty" data-id="${item.id}" data-qty="${item.quantity + 1}" ${item.quantity >= currentStock ? 'disabled' : ''} aria-label="Increase quantity of ${title}">+</button>
                    <button class="remove-btn" data-id="${item.id}" aria-label="Remove ${title} from cart">&times;</button>
                </div>`;
            cartItemsContainer.appendChild(div);
        });

        cartTotalEl.textContent = currentTotal.toFixed(2);
        checkoutBtn.disabled = false; // Re-enable if cart is not empty

        // Add event listeners for cart item controls using delegation
        addCartItemListeners();
    }

    // Use event delegation for cart item controls
    function addCartItemListeners() {
         if (!cartItemsContainer) return;

         // Remove previous listeners to avoid duplication if renderCart is called multiple times
         // This is a simple approach; more complex scenarios might need more robust listener management
         cartItemsContainer.replaceWith(cartItemsContainer.cloneNode(true)); // Clone to remove listeners
         cartItemsContainer = document.getElementById('cartItems'); // Re-select the new node

        cartItemsContainer.addEventListener('click', (event) => {
            const target = event.target;
            const bookId = target.dataset.id;

            if (target.classList.contains('increase-qty') || target.classList.contains('decrease-qty')) {
                 const newQty = parseInt(target.dataset.qty, 10);
                 if (!isNaN(newQty)) {
                    updateQty(bookId, newQty);
                 }
            } else if (target.classList.contains('remove-btn')) {
                removeItem(bookId);
            }
        });
    }


    function updateQty(id, newQty) {
        // Basic validation (already done in parseInt check, but good practice)
        if (isNaN(newQty) || newQty < 0) {
            console.warn("Invalid new quantity provided:", newQty);
            return;
        }

        if (newQty === 0) {
            return removeItem(id); // Remove item if quantity becomes 0
        }

        const book = allBooks.find(b => b.id === id);
        const stock = book?.stock ?? 0; // Get current stock, default 0

        // Check against current stock (UX check)
        if (newQty > stock) {
            alert(`Sorry, only ${stock} items available for "${book?.title || 'this item'}".`);
            // Do not update quantity beyond stock
            // Re-render to potentially disable the '+' button again if needed
            renderCart();
            return;
        }

        // Find item and update quantity
        const itemIndex = cart.findIndex(item => item.id === id);
        if (itemIndex > -1) {
             cart[itemIndex].quantity = newQty;
             saveCart();
             renderCart(); // Re-render cart to reflect the change
        } else {
            console.warn(`Item with id ${id} not found in cart for update.`);
        }
    }

    function removeItem(id) {
        cart = cart.filter(item => item.id !== id);
        saveCart();
        renderCart(); // Re-render cart after removal
    }

    // --- Initialize Stripe Payment Element ---
    async function initializePaymentElement(clientSecret) {
        // Check required elements exist
        if (!paymentElement || !paymentForm || !paymentMessage || !paymentSubmitButton) {
             console.error("Payment form elements missing in HTML.");
              if (paymentMessage) {
                  paymentMessage.textContent = "Error: Payment form elements not found.";
                  paymentMessage.style.color = 'red';
              }
             return false; // Indicate failure
        }

        if (!clientSecret) {
            console.error("Client secret is missing for payment element initialization.");
            paymentMessage.textContent = "Unable to set up payment form (missing secret). Please try again.";
            paymentMessage.style.color = 'red';
            paymentForm.style.display = 'none'; // Hide form
            return false; // Indicate failure
        }

        // Clear previous instances and messages
        paymentElement.innerHTML = '';
        paymentMessage.textContent = '';

        const appearance = { theme: 'stripe' /* or 'flat', 'night' */ };

        try {
            // Create a Stripe Elements instance
            elements = stripe.elements({ appearance, clientSecret });

            // Create and mount the Payment Element
            const paymentElementInstance = elements.create('payment');
            paymentElementInstance.mount(paymentElement);

            // Show the payment form and enable submit button
            paymentForm.style.display = 'block';
             paymentSubmitButton.disabled = false;
            console.log("Stripe Payment Element mounted.");
             return true; // Indicate success

        } catch (error) {
             console.error("Error initializing Stripe Elements:", error);
             paymentMessage.textContent = "Error setting up payment form. Please try again.";
             paymentMessage.style.color = 'red';
             paymentForm.style.display = 'none'; // Hide form on error
              return false; // Indicate failure
        }
    }


    // --- Confirm Payment with Stripe ---
    async function confirmPayment() {
        // Check required elements/state
        if (!elements || !paymentIntentClientSecret || !stripe || !paymentForm || !paymentMessage || !paymentSubmitButton || !orderStatusEl) {
            console.error("Cannot confirm payment: Missing Stripe elements, client secret, or DOM elements.");
             if (paymentMessage) {
                 paymentMessage.textContent = "Payment confirmation error. Please try refreshing.";
                 paymentMessage.style.color = 'red';
             }
              // Re-enable button if it exists
              if(paymentSubmitButton) paymentSubmitButton.disabled = false;
            return;
        }


        // Disable button and show processing message
        paymentSubmitButton.disabled = true;
        paymentMessage.textContent = 'Processing payment...';
        paymentMessage.style.color = 'inherit'; // Reset color
        orderStatusEl.textContent = 'Processing payment...'; // Update main status too
        orderStatusEl.className = 'info';


        try {
            const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
                elements,
                clientSecret: paymentIntentClientSecret,
                confirmParams: {
                    // return_url should point to a page on your site where Stripe can redirect the user
                    // after actions like 3D Secure. For simplicity, using current page.
                    // Production: Use a dedicated success/status page URL.
                    return_url: window.location.href.split('?')[0] + '?payment_status=complete', // Example: Add param to check on reload
                },
                redirect: 'if_required', // Redirect only if necessary (e.g., 3DS)
            });

            // This point is typically reached only if:
            // 1. There's an immediate validation error (stripeError is populated).
            // 2. Payment succeeds without needing a redirect (paymentIntent is populated, stripeError is null).
            // 3. If redirect *was* required, the user returns to the return_url, and you should
            //    check the paymentIntent status on that page load (logic not included here).

            if (stripeError) {
                // Handle immediate errors (e.g., invalid card details)
                console.error("Stripe payment confirmation failed (immediate error):", stripeError);
                paymentMessage.textContent = stripeError.message || "Payment failed. Please check your details.";
                paymentMessage.style.color = 'red';
                orderStatusEl.textContent = `Payment failed: ${stripeError.message || 'Please check details.'}`;
                orderStatusEl.className = 'error';

                // IMPORTANT: Even on immediate client-side failure, the PaymentIntent *might* have been created.
                // Your webhook handler should ideally check for failed statuses too.

                // Re-enable the payment form submission button
                paymentSubmitButton.disabled = false;

            } else if (paymentIntent) {
                 // Payment succeeded client-side *without* requiring a redirect OR user returned after redirect.
                 // **CRITICAL**: This is NOT final confirmation for fulfillment. Use Webhooks!
                console.log("Stripe payment confirmation successful (client-side/returned):", paymentIntent.id, paymentIntent.status);

                // Update UI to reflect success (pending webhook confirmation for fulfillment)
                paymentMessage.textContent = 'Payment successful! Finalizing order...';
                paymentMessage.style.color = 'green';
                 orderStatusEl.textContent = 'Payment successful! Your order is being processed.';
                 orderStatusEl.className = 'success';

                 // Hide the payment form
                 paymentForm.style.display = 'none';

                 // Clear the cart (as payment was initiated successfully client-side)
                 // In production, you might wait for webhook confirmation before clearing,
                 // or show a "Processing" state until fulfillment.
                 cart = [];
                 saveCart();
                 renderCart(); // Update cart UI (will show empty)

                // Keep checkout button disabled until cart is empty or state resets
                checkoutBtn.disabled = true;
                checkoutBtn.textContent = 'Checkout';

                // Do NOT call fetchBooks() here. Stock updates happen server-side via webhook.

                // Optional: Redirect to a dedicated success page after a short delay
                // setTimeout(() => {
                //    window.location.href = '/order-success.html?order_id=' + paymentIntent.metadata?.order_id; // Assuming order_id in metadata
                // }, 2000);

            } else {
                 // Fallback case - should not typically happen if redirect: 'if_required' is used
                 console.warn("Stripe confirmPayment returned without error or paymentIntent.");
                 paymentMessage.textContent = 'Payment status uncertain. Please check your account or contact support.';
                 orderStatusEl.textContent = 'Payment status uncertain.';
                 orderStatusEl.className = 'warning';
                  paymentSubmitButton.disabled = false; // Re-enable
            }

        } catch (error) {
             // Catch any unexpected errors during the confirmation process
             console.error("Error during Stripe payment confirmation:", error);
             paymentMessage.textContent = 'An unexpected error occurred during payment. Please try again.';
             paymentMessage.style.color = 'red';
              orderStatusEl.textContent = 'An unexpected payment error occurred.';
              orderStatusEl.className = 'error';
               paymentSubmitButton.disabled = false; // Re-enable button
        }
    }


    // --- Secure Checkout Flow (Calls Cloud Function) ---
    async function handleCheckout() {
         if (!checkoutBtn || !orderStatusEl || !paymentForm || !paymentMessage) return; // Check elements

        if (cart.length === 0) {
            alert("Your cart is empty.");
            return;
        }

        // Disable button, show processing
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = 'Processing...';
        orderStatusEl.textContent = 'Preparing your order...';
        orderStatusEl.className = 'info';
        if (paymentForm) paymentForm.style.display = 'none'; // Hide payment form initially
        if (paymentMessage) paymentMessage.textContent = '';

        // --- Client-Side Validation (Basic) ---
        let hasInvalidItems = false;
        const itemsToProcess = cart
            .map(item => {
                if (!item || !item.id || typeof item.quantity !== 'number' || item.quantity <= 0) {
                    console.warn("Skipping invalid item in cart during checkout preparation:", item);
                    hasInvalidItems = true;
                    return null; // Mark as invalid
                }
                 // Find the book to check current stock for a preliminary check (UX)
                 const bookData = allBooks.find(b => b.id === item.id);
                 const currentStock = bookData?.stock ?? 0;
                 if (item.quantity > currentStock) {
                      alert(`Item "${item.title || item.id}" quantity (${item.quantity}) exceeds available stock (${currentStock}). Please update your cart.`);
                      hasInvalidItems = true; // Treat as invalid for proceeding
                      return null;
                 }

                // Send only ID and quantity to backend for security
                return {
                    bookId: item.id,
                    quantity: item.quantity
                };
            })
            .filter(item => item !== null); // Remove invalid items marked as null

        console.log("Valid items being sent to processOrder function:", itemsToProcess);

        if (itemsToProcess.length === 0) {
            let message = "Checkout cannot proceed.";
            if (hasInvalidItems) {
                message = "Please resolve issues in your cart (invalid items or insufficient stock).";
                 renderCart(); // Re-render to show warnings/updates
            } else {
                 message = "Your cart contains no valid items to checkout."; // Should be caught earlier, but safety check
            }
            alert(message);
            orderStatusEl.textContent = message;
            orderStatusEl.className = 'error';
            checkoutBtn.disabled = cart.length === 0; // Re-enable only if cart isn't technically empty
             checkoutBtn.textContent = 'Checkout';
            return; // Stop checkout
        }

        // --- Prepare data for Cloud Function ---
        const orderData = {
            items: itemsToProcess
            // Add other relevant data if needed by your function (e.g., currency)
            // currency: 'usd' // Example: if your function expects currency
        };

        // !!! IMPORTANT: Replace with your ACTUAL deployed Cloud Function HTTP URL !!!
        const cloudFunctionUrl = 'https://us-central1-eritrean-bookstore.cloudfunctions.net/processOrder';

        if (cloudFunctionUrl.includes('https://YOUR_REGION-YOUR_PROJECT_ID.cloudfunctions.net/processOrder') || cloudFunctionUrl.includes('replace-this-url')) {
             console.error("CRITICAL: Cloud Function URL is not set!");
             orderStatusEl.textContent = 'Checkout configuration error. Cannot proceed.';
             orderStatusEl.className = 'error';
             checkoutBtn.disabled = false; // Re-enable
             checkoutBtn.textContent = 'Checkout';
             return;
        }


        try {
            // --- Call the HTTP Cloud Function ---
             orderStatusEl.textContent = 'Connecting to server...';
            const response = await fetch(cloudFunctionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

             orderStatusEl.textContent = 'Processing order details...'; // Update status

            // --- Handle Function Response ---
            if (!response.ok) {
                // Attempt to parse error details from the function's response body
                let errorDetails = `Server returned status ${response.status}.`;
                try {
                    const errorResponseData = await response.json();
                    console.error("Cloud Function Error Response:", errorResponseData);
                    // Use the specific error message from the function if available
                    errorDetails = errorResponseData.message || errorDetails + (errorResponseData.error ? ` ${errorResponseData.error}` : '');
                      // If specific stock error message received, update UI
                     if (errorResponseData.code === 'out-of-stock' || errorResponseData.error?.includes('stock')) {
                         alert(`Checkout failed: ${errorDetails} Please review your cart.`);
                         fetchBooks(); // Re-fetch books to show updated stock
                         renderCart(); // Re-render cart potentially showing warnings
                     }

                } catch (parseError) {
                     // Body wasn't JSON or empty, use status text
                     errorDetails += ` ${response.statusText || '(No error details provided)'}`;
                      console.error("HTTP error calling Cloud Function, failed to parse response:", response.status, response.statusText);
                }
                throw new Error(`Checkout failed: ${errorDetails}`); // Throw to be caught below
            }

            // --- Success: Initialize Payment Element ---
            const responseData = await response.json();

            // **Crucial Check**: Ensure clientSecret is present in the response
            if (!responseData || !responseData.clientSecret) {
                 console.error("Cloud Function Response missing clientSecret:", responseData);
                 throw new Error("Checkout failed: Invalid response from server (missing payment details).");
            }

            paymentIntentClientSecret = responseData.clientSecret; // Store the secret globally
            const orderId = responseData.orderId; // Assuming function returns orderId too
            console.log(`Order ${orderId || 'N/A'} initiated. Client Secret received.`);


             orderStatusEl.textContent = 'Order ready. Please enter payment details.';
              orderStatusEl.className = 'info';

            // Initialize the Stripe Payment Element with the received secret
             const initSuccess = await initializePaymentElement(paymentIntentClientSecret);
             if (!initSuccess) {
                 // Error initializing payment element handled inside the function
                  // Re-enable checkout button as payment form failed to show
                 checkoutBtn.disabled = false;
                 checkoutBtn.textContent = 'Checkout';
             }
             // If initSuccess is true, payment form is shown, checkout button remains disabled


        } catch (error) {
             console.error("Error during handleCheckout:", error);
             orderStatusEl.textContent = error.message || 'Checkout failed. Please try again.';
             orderStatusEl.className = 'error';
             // Re-enable the checkout button on failure
             checkoutBtn.disabled = false;
             checkoutBtn.textContent = 'Checkout';
              // Consider re-fetching books in case of stock errors that might have been logged
              if (error.message.includes('stock')) {
                  fetchBooks();
              }
        }
    }


    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Search Input (with Debounce)
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                debounce(handleSearch, DEBOUNCE_DELAY);
            });
        }

        // Cart Toggle Button
        if (cartToggleButton) {
            cartToggleButton.addEventListener('click', toggleCart);
        }

        // Cart Close Button
        if (cartCloseButton) {
            cartCloseButton.addEventListener('click', toggleCart);
        }

        // Cart Overlay Click to Close
        if (cartOverlay) {
            cartOverlay.addEventListener('click', (event) => {
                // Close only if clicking the overlay itself, not its children (the panel)
                if (event.target === cartOverlay) {
                    toggleCart();
                }
            });
        }

        // Main Checkout Button (in Cart Panel)
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', handleCheckout);
        }

        // Payment Form Submission
        if (paymentForm) {
            paymentForm.addEventListener('submit', async (event) => {
                event.preventDefault(); // Prevent default form submission
                await confirmPayment(); // Call the Stripe confirmation function
            });
        }

         // Add listeners for book cards (delegation might be complex here, handled in renderBooks)

         // Listen for Esc key to close cart
         document.addEventListener('keydown', (event) => {
              if (event.key === 'Escape' && cartPanel && cartPanel.classList.contains('open')) {
                   toggleCart();
              }
         });
    }

    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof firebase === 'undefined') {
             console.error("Firebase not loaded, cannot initialize application.");
             // Maybe display an error message permanently on the page
             return;
        }
         if (!stripe) {
              console.error("Stripe.js not loaded or initialized correctly.");
              // Maybe display an error message
              return;
         }


        cacheDOMElements(); // Cache elements once DOM is ready

        if (currentYearEl) {
            currentYearEl.textContent = new Date().getFullYear();
        }

        fetchBooks();      // Fetch books on page load
        updateCartCount(); // Set initial cart count display
        saveCart();        // Ensure checkout button state is correct based on initial cart
        setupEventListeners(); // Setup all event listeners
    });
