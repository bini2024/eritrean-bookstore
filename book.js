 // --- Firebase Configuration ---
    // WARNING: Ensure your Firestore security rules are properly configured!
    const firebaseConfig = {
        apiKey: "AIzaSyBE3_ivAE2WFXQ3H8m1OWqM9APvRrI-Ac0", // Replace if necessary, keep secure
        authDomain: "eritrean-bookstore.firebaseapp.com",
        projectId: "eritrean-bookstore",
        storageBucket: "eritrean-bookstore.appspot.com", // Verify this format is correct for your project
        messagingSenderId: "645911365846",
        appId: "1:645911365846:web:5cd71799c6969bcaa1a177"
    };

    // --- Initialize Firebase (v8 Compat SDKs Expected) ---
    // Requires:
    // <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
    // <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
    // <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-functions-compat.js"></script> // Optional for HTTP triggers
    // <script src="https://js.stripe.com/v3/"></script> // Stripe SDK

    let app, db;
    try {
        if (typeof firebase === 'undefined' || typeof firebase.initializeApp !== 'function') {
             throw new Error("Firebase SDK (v8 compat) not loaded. Check <head> scripts.");
        }
        app = firebase.initializeApp(firebaseConfig);
        db = firebase.firestore(); // Use v8 compat syntax

    } catch (error) {
        console.error("CRITICAL: Firebase Initialization Error:", error);
        // Display a critical error to the user if Firebase fails to load
        document.body.innerHTML = `<p style="color: red; padding: 20px; font-family: sans-serif;"><b>Application Initialization Failed.</b><br>Could not initialize Firebase. Please ensure Firebase SDK scripts are loaded correctly in the HTML head and the configuration is valid. Check the browser console for details.</p>`;
    }

    // --- Constants ---
    const BOOKS_COLLECTION = 'books';
    const ORDERS_COLLECTION = 'orders'; // Primarily used server-side
    const DEBOUNCE_DELAY = 300; // ms for search debounce

    // --- Global State ---
    let allBooks = [];
    let cart = Array.isArray(JSON.parse(localStorage.getItem('cart'))) ? JSON.parse(localStorage.getItem('cart')) : [];
    let searchTimeout;

    // --- Stripe Initialization ---
    // !!! CRITICAL: Replace with your ACTUAL Stripe Publishable Key !!!
    const stripePublishableKey = 'pk_test_YOUR_PUBLISHABLE_KEY'; // e.g., pk_test_51... or pk_live_51...
    let stripe = null;
    if (!stripePublishableKey || !stripePublishableKey.startsWith('pk_')) {
        console.error("CRITICAL: Stripe Publishable Key is missing or invalid! Payment will not work.");
        // Display error to user?
    } else {
       try {
            stripe = Stripe(stripePublishableKey);
       } catch (e) {
            console.error("CRITICAL: Failed to initialize Stripe. Check key and Stripe SDK loading.", e);
            stripe = null; // Ensure stripe is null if init failed
       }
    }
    let paymentIntentClientSecret = null; // Holds the secret from the Cloud Function
    let elements; // Holds the Stripe Elements instance

    // --- DOM Element Caching (IDs must match your HTML exactly!) ---
    let booksGrid, searchInput, cartPanel, cartOverlay, cartItemsContainer, cartTotalEl, cartCountEl, checkoutBtn, orderStatusEl, cartToggleButton, cartCloseButton, booksErrorEl, currentYearEl, paymentForm, paymentElement, paymentMessage, paymentSubmitButton;

    function cacheDOMElements() {
        // !!! CRITICAL: Ensure HTML elements with these IDs exist !!!
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
             console.error("Essential DOM elements are missing! Check your HTML `id` attributes match the script expectations (e.g., 'booksGrid', 'cartPanel', etc.).");
             // Optional: Display a user-facing error message
             if(booksErrorEl) booksErrorEl.textContent = "Page structure error. Cannot load store.";
             return false; // Indicate failure
        }
        return true; // Indicate success
    }

    // --- Utility Functions ---
    function scrollToElement(id) {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        } else {
            console.warn(`scrollToElement: Element with id '${id}' not found.`);
        }
    }

    function toggleCart() {
        if (!cartPanel || !cartOverlay) {
             console.error("Cannot toggle cart: cartPanel or cartOverlay element not found.");
             return;
        }
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
            if(orderStatusEl) orderStatusEl.textContent = "Error saving cart.";
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
        if (!booksGrid || !booksErrorEl) {
             console.error("Cannot fetch books: booksGrid or booksErrorEl element not found.");
             return;
        }

        booksErrorEl.textContent = '';
        booksGrid.innerHTML = '<p>Loading books...</p>'; // Loading indicator

        try {
            if (!db) throw new Error("Firestore database is not initialized.");

            // Fetch books (consider adding .orderBy() if needed)
            const snapshot = await db.collection(BOOKS_COLLECTION).get(); // v8 get()

            if (snapshot.empty) {
                console.log("Firestore 'books' collection is empty.");
                allBooks = [];
                renderBooks(allBooks); // Render empty state explicitly
                return; // Exit function after rendering empty state
            }

            // Map Firestore docs to book objects
            allBooks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderBooks(allBooks);

        } catch (error) {
            console.error("Error fetching books from Firestore:", error);
            booksErrorEl.textContent = 'Failed to load books. Check Firestore connection, rules, or collection name.';
            booksGrid.innerHTML = ''; // Clear loading message on error
            allBooks = []; // Ensure allBooks is empty on error
             renderBooks(allBooks); // Render empty state on error
        }
    }

    function renderBooks(bookList) {
         if (!booksGrid || !searchInput || !booksErrorEl) {
             console.error("Cannot render books: Critical elements missing (booksGrid, searchInput, booksErrorEl).");
             if(booksGrid) booksGrid.innerHTML = '<p style="color:red;">Error displaying books.</p>';
             return;
         }

        booksGrid.innerHTML = ''; // Clear current grid content

        if (!Array.isArray(bookList)) {
            booksGrid.innerHTML = '<p>Error: Book data format incorrect.</p>';
            console.error("renderBooks received invalid data:", bookList);
            return;
        }

        const searchTerm = searchInput.value.trim();

        // Display appropriate message based on context
        if (bookList.length === 0) {
             let message = '<p>No books to display.</p>'; // Default
             if (searchTerm !== '') {
                 message = '<p>No books match your search.</p>';
             } else if (allBooks.length === 0 && booksErrorEl.textContent === '') {
                 // Initial fetch successful but no books in DB
                  message = '<p>No books available at the moment.</p>';
             } else if (booksErrorEl.textContent !== '') {
                 // Error message is already displayed by fetchBooks
                 message = ''; // Keep grid clear if fetch failed
             }
             booksGrid.innerHTML = message;
        } else {
            bookList.forEach(book => {
                // Validate data and provide defaults
                const bookId = book.id; // Get ID for inputs/buttons
                const title = escapeHTML(book.title || 'Untitled Book');
                const stock = typeof book.stock === 'number' && book.stock >= 0 ? book.stock : 0;
                const price = typeof book.price === 'number' && book.price >= 0 ? book.price : 0.00;
                const imgURL = book.imgURL || 'placeholder.jpg'; // Use a placeholder image if URL is missing
                const isOutOfStock = stock <= 0;

                const card = document.createElement('div');
                card.className = 'book-card';
                card.innerHTML = `
                    <img src="${imgURL}" alt="${title}" loading="lazy">
                    <div class="book-info">
                        <div>
                            <h3>${title}</h3>
                            <p>$${price.toFixed(2)}</p>
                             ${isOutOfStock ? '<p style="color: red; font-weight: bold;">Out of Stock</p>' : ''}
                        </div>
                        <div class="controls">
                            <label for="qty-${bookId}" class="sr-only">Quantity for ${title}</label>
                            <input type="number" min="1" max="${stock}" value="1" class="qty" id="qty-${bookId}" aria-label="Quantity for ${title}" ${isOutOfStock ? 'disabled' : ''}>
                            <button class="add-btn" data-book-id="${bookId}" ${isOutOfStock ? 'disabled' : ''}>
                                Add to Cart
                            </button>
                        </div>
                    </div>`;

                const addButton = card.querySelector('.add-btn');
                const qtyInput = card.querySelector(`#qty-${bookId}`);

                if (addButton && qtyInput && !isOutOfStock) {
                    addButton.addEventListener('click', () => {
                        const quantity = parseInt(qtyInput.value, 10); // Use radix 10

                        if (isNaN(quantity) || quantity < 1) {
                            alert('Please enter a valid positive quantity.');
                            qtyInput.value = '1'; // Reset input
                            return;
                        }

                        // Fetch the latest stock info just before adding (more robust UX check)
                        const currentBookData = allBooks.find(b => b.id === bookId);
                        const currentStockNow = currentBookData?.stock ?? 0;

                        if (quantity > currentStockNow) {
                            alert(`Cannot add ${quantity}. Only ${currentStockNow} "${title}" available.`);
                             qtyInput.value = currentStockNow > 0 ? currentStockNow : '1'; // Reset to max available or 1
                            return;
                        }

                        addToCart(bookId, quantity);

                        // Provide visual feedback
                        addButton.textContent = 'Added!';
                        addButton.disabled = true;
                        setTimeout(() => {
                            // Check if button still exists in case DOM changed rapidly
                            const currentAddButton = booksGrid.querySelector(`[data-book-id="${bookId}"]`);
                            if(currentAddButton) {
                                currentAddButton.textContent = 'Add to Cart';
                                currentAddButton.disabled = false;
                            }
                            if(qtyInput) qtyInput.value = '1'; // Reset quantity input after adding
                        }, 1000); // Show 'Added!' for 1 second
                    });
                } else if (addButton && isOutOfStock) {
                     // Explicitly set text if out of stock (already done in HTML, but reinforces)
                     addButton.textContent = 'Out of Stock';
                }
                booksGrid.appendChild(card);
            });
        }
    }

    // Search functionality (triggered by event listener)
    function handleSearch() {
        if (!searchInput) {
             console.error("Cannot search: searchInput element not found.");
             return;
        }
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
        if (!book || typeof book.price !== 'number' || typeof book.stock !== 'number') { // Allow stock 0 initially for comparison
            console.error("Attempted to add book with invalid data:", bookId, book);
            alert("Error: Could not add item due to invalid book data.");
            return;
        }
         if (typeof quantityToAdd !== 'number' || quantityToAdd < 1) {
             console.warn("Attempted to add invalid quantity:", quantityToAdd);
              alert("Please enter a valid quantity.");
             return;
         }

        const currentStock = book.stock;
        if (currentStock <= 0) {
            alert(`Sorry, "${book.title || 'item'}" is currently out of stock.`);
            return;
        }

        const existingCartItemIndex = cart.findIndex(item => item.id === bookId);
        let currentCartQty = 0;

        if (existingCartItemIndex > -1) {
            currentCartQty = cart[existingCartItemIndex].quantity;
        }

        const potentialNewTotalQty = currentCartQty + quantityToAdd;

        // Client-side stock check (UX only, real check is server-side)
        if (currentStock < potentialNewTotalQty) {
            alert(`Sorry, only ${currentStock} "${book.title || 'item'}" available in total. You already have ${currentCartQty} in your cart.`);
            return;
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
         if (!cartItemsContainer || !cartTotalEl || !checkoutBtn || !orderStatusEl) {
             console.error("Cannot render cart: Critical elements missing.");
             return;
         }

        cartItemsContainer.innerHTML = ''; // Clear current cart content
        let currentTotal = 0;
        // Do not clear orderStatusEl here, it might show important checkout messages

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
            // Use data-* attributes for easier event delegation
            div.innerHTML = `
                <img src="${item.imgURL || 'placeholder.jpg'}" alt="${title}" style="width: 40px; height: auto; vertical-align: middle; margin-right: 8px; border-radius: 4px;">
                <div class="item-info">
                    <strong>${title}</strong>
                    <span>$${price.toFixed(2)} x ${item.quantity} = $${itemTotal.toFixed(2)}</span>
                    ${item.quantity > currentStock ? `<br><small style="color:red; font-weight:bold;">Warning: Quantity exceeds available stock (${currentStock})!</small>` : ''}
                </div>
                <div class="item-controls">
                    <button class="qty-btn decrease-qty" data-id="${item.id}" data-change="-1" aria-label="Decrease quantity of ${title}">-</button>
                    <span class="item-qty" aria-live="polite">${item.quantity}</span>
                    <button class="qty-btn increase-qty" data-id="${item.id}" data-change="1" ${item.quantity >= currentStock ? 'disabled' : ''} aria-label="Increase quantity of ${title}">+</button>
                    <button class="remove-btn" data-id="${item.id}" aria-label="Remove ${title} from cart">&times;</button>
                </div>`;
            cartItemsContainer.appendChild(div);
        });

        cartTotalEl.textContent = currentTotal.toFixed(2);
        checkoutBtn.disabled = false; // Re-enable if cart is not empty

        // Add event listeners for cart item controls using delegation (done once in setup)
        // Ensure listeners are active or re-add if necessary (simple approach assumes setupEventListeners handles it)
    }

    // Event handler for cart item clicks (called by delegated listener)
    function handleCartItemClick(event) {
        const target = event.target;
        const bookId = target.dataset.id;

        if (!bookId) return; // Clicked somewhere else in the container

        if (target.classList.contains('increase-qty') || target.classList.contains('decrease-qty')) {
            const change = parseInt(target.dataset.change, 10);
            const itemIndex = cart.findIndex(item => item.id === bookId);
            if (itemIndex > -1 && !isNaN(change)) {
                const currentQty = cart[itemIndex].quantity;
                const newQty = currentQty + change;
                updateQty(bookId, newQty); // updateQty handles validation (>=0, stock check)
            }
        } else if (target.classList.contains('remove-btn')) {
            removeItem(bookId);
        }
    }


    function updateQty(id, newQty) {
         // Validate newQty must be >= 0
         if (isNaN(newQty) || newQty < 0) {
             console.warn("Invalid new quantity provided:", newQty);
             return; // Don't proceed
         }

        if (newQty === 0) {
            return removeItem(id); // Remove item if quantity becomes 0
        }

        const book = allBooks.find(b => b.id === id);
        const stock = book?.stock ?? 0; // Get current stock, default 0

        // Check against current stock (UX check)
        if (newQty > stock) {
            alert(`Sorry, only ${stock} items available for "${book?.title || 'this item'}". Cannot increase quantity.`);
            // Do not update quantity beyond stock
            renderCart(); // Re-render to ensure '+' button state is correct
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
             console.error("Payment form elements missing in HTML. Cannot initialize Stripe Element.");
              if (paymentMessage) {
                  paymentMessage.textContent = "Error: Payment form elements not found.";
                  paymentMessage.style.color = 'red';
              }
             return false; // Indicate failure
        }
        if (!stripe) {
            console.error("Stripe object not initialized. Cannot initialize Stripe Element.");
            paymentMessage.textContent = "Error: Payment service failed to load.";
            paymentMessage.style.color = 'red';
            return false;
        }


        if (!clientSecret) {
            console.error("Client secret is missing for payment element initialization.");
            paymentMessage.textContent = "Unable to set up payment form (missing secret). Please try initiating checkout again.";
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
             paymentMessage.textContent = "Error setting up payment form. Please refresh and try again.";
             paymentMessage.style.color = 'red';
             paymentForm.style.display = 'none'; // Hide form on error
              return false; // Indicate failure
        }
    }


    // --- Confirm Payment with Stripe ---
    async function confirmPayment() {
        // Check required elements/state
        if (!elements || !paymentIntentClientSecret || !stripe || !paymentForm || !paymentMessage || !paymentSubmitButton || !orderStatusEl) {
            console.error("Cannot confirm payment: Missing Stripe elements, client secret, Stripe object, or DOM elements.");
             if (paymentMessage) {
                 paymentMessage.textContent = "Payment confirmation error. Please refresh the page and try again.";
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
             // Construct the return URL carefully. Using origin + pathname avoids issues with existing query params/hashes.
             // Add a clear indicator for success/failure checking on return.
            const returnUrlBase = window.location.origin + window.location.pathname;

            const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
                elements,
                // clientSecret: paymentIntentClientSecret, // This seems redundant if elements created with it? Check Stripe Docs if issues arise.
                confirmParams: {
                    // return_url is essential for payment methods that redirect.
                    return_url: returnUrlBase + '?payment_status=returned', // Example: Add param to check on reload/return
                },
                redirect: 'if_required', // Redirect only if necessary (e.g., 3DS)
            });

            // This point is typically reached ONLY if:
            // 1. Immediate validation error (stripeError is populated).
            // 2. Payment succeeds without needing a redirect (paymentIntent populated, stripeError null).
            // NOTE: If redirect *was* required, the user returns to the return_url. You'd need
            // separate logic on page load to check `payment_status=returned` in the URL,
            // retrieve the PaymentIntent status using the client_secret from the URL, and update UI.
            // This example focuses on the immediate success/error cases.

            if (stripeError) {
                 // Handle card validation errors or other immediate failures
                console.error("Stripe payment confirmation failed (immediate error):", stripeError.type, stripeError.message);
                 let userMessage = stripeError.message || "Payment failed. Please check your details.";
                 if(stripeError.type === "card_error" || stripeError.type === "validation_error") {
                     // Specific message for card/validation issues
                      paymentMessage.textContent = userMessage;
                 } else {
                      // More generic error for other types
                      paymentMessage.textContent = "An unexpected error occurred during payment. Please try again.";
                 }
                paymentMessage.style.color = 'red';
                orderStatusEl.textContent = `Payment failed: ${userMessage}`;
                orderStatusEl.className = 'error';
                paymentSubmitButton.disabled = false; // Re-enable button

            } else if (paymentIntent) {
                 // Payment succeeded client-side *without* needing redirect OR user returned (needs separate check logic for return)
                 // **CRITICAL**: This is NOT final confirmation for fulfillment. Use Webhooks!
                console.log("Stripe payment confirmation successful (client-side/no-redirect case):", paymentIntent.id, paymentIntent.status);

                 // Handle potential statuses ( 'succeeded', 'processing', 'requires_capture', etc.)
                 // For this example, assume 'succeeded' or 'processing' means clear cart UI.
                 // Robust handling depends on your payment flow (e.g., capture later?).
                 if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
                     paymentMessage.textContent = 'Payment successful! Finalizing order...';
                     paymentMessage.style.color = 'green';
                     orderStatusEl.textContent = 'Payment successful! Your order is being processed.';
                     orderStatusEl.className = 'success';

                     // Hide the payment form
                     paymentForm.style.display = 'none';

                     // Clear the cart (as payment was initiated successfully client-side)
                     // Based on client-side success, NOT webhook confirmation (simplification for demo)
                     cart = [];
                     saveCart();
                     renderCart(); // Update cart UI (will show empty)

                    checkoutBtn.disabled = true; // Keep checkout disabled as cart is now empty
                    checkoutBtn.textContent = 'Checkout';

                    // Do NOT call fetchBooks() here. Stock updates happen server-side via webhook.

                 } else {
                      // Handle other statuses if necessary (e.g., requires_action, requires_payment_method)
                       console.warn("PaymentIntent status after confirmation:", paymentIntent.status);
                       paymentMessage.textContent = `Payment status: ${paymentIntent.status}. Follow instructions if prompted.`;
                       orderStatusEl.textContent = `Payment status: ${paymentIntent.status}`;
                       orderStatusEl.className = 'info';
                       paymentSubmitButton.disabled = false; // Allow retry if needed for some statuses
                 }

            } else {
                 // Fallback case - should not typically happen with redirect: 'if_required'
                 console.warn("Stripe confirmPayment resolved without error or paymentIntent. Status uncertain.");
                 paymentMessage.textContent = 'Payment status uncertain. Please check your account or contact support.';
                 orderStatusEl.textContent = 'Payment status uncertain.';
                 orderStatusEl.className = 'warning';
                  paymentSubmitButton.disabled = false; // Re-enable
            }

        } catch (error) {
             // Catch any unexpected errors during the confirmation process itself
             console.error("Error during Stripe payment confirmation call:", error);
             paymentMessage.textContent = 'An unexpected error occurred during payment confirmation. Please try again.';
             paymentMessage.style.color = 'red';
              orderStatusEl.textContent = 'An unexpected payment confirmation error occurred.';
              orderStatusEl.className = 'error';
               paymentSubmitButton.disabled = false; // Re-enable button
        }
    }


    // --- Secure Checkout Flow (Calls Cloud Function) ---
    async function handleCheckout() {
         if (!checkoutBtn || !orderStatusEl || !paymentForm || !paymentMessage) {
            console.error("Cannot handle checkout: Critical DOM elements missing.");
            return;
         }

        if (cart.length === 0) {
            alert("Your cart is empty.");
            return;
        }

        // Disable button, show processing
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = 'Processing...';
        orderStatusEl.textContent = 'Checking cart and stock...';
        orderStatusEl.className = 'info';
        if (paymentForm) paymentForm.style.display = 'none'; // Ensure payment form is hidden
        if (paymentMessage) paymentMessage.textContent = '';

        // --- Client-Side Validation & Stock Check (UX Enhancement) ---
        let hasIssues = false;
        const itemsToProcess = [];
        // Use a loop for clearer async checks if needed in future, though not needed here
        for (const item of cart) {
             if (!item || !item.id || typeof item.quantity !== 'number' || item.quantity <= 0) {
                 console.warn("Skipping invalid item in cart during checkout:", item);
                 hasIssues = true;
                 continue; // Skip this item
             }
             // Find the book to check current stock for a preliminary check (UX)
             const bookData = allBooks.find(b => b.id === item.id);
             const currentStock = bookData?.stock ?? -1; // Use -1 to indicate data missing/error

              if (currentStock === -1) {
                 console.error(`Could not verify stock for item ${item.id}. Book data might be missing.`);
                  alert(`Error checking stock for "${item.title || item.id}". Cannot proceed.`);
                  hasIssues = true;
                  break; // Stop processing if we can't verify stock
              } else if (item.quantity > currentStock) {
                  alert(`Item "${item.title || item.id}" quantity (${item.quantity}) exceeds available stock (${currentStock}). Please update your cart.`);
                  hasIssues = true;
                  break; // Stop processing if stock issue found
              }

             // Send only ID and quantity to backend for security
             itemsToProcess.push({
                 bookId: item.id,
                 quantity: item.quantity
             });
        }


        if (hasIssues) {
             orderStatusEl.textContent = "Checkout failed: Please resolve issues in your cart (check quantities or stock).";
             orderStatusEl.className = 'error';
             renderCart(); // Re-render to show latest warnings/stock states
             checkoutBtn.disabled = false; // Allow user to retry after fixing
             checkoutBtn.textContent = 'Checkout';
             return; // Stop checkout
        }

        if (itemsToProcess.length === 0) {
             // This case should ideally be caught by the hasIssues check, but acts as a fallback
             alert("Your cart contains no valid items to checkout.");
             orderStatusEl.textContent = "Your cart contains no valid items to checkout.";
             orderStatusEl.className = 'error';
             checkoutBtn.disabled = cart.length === 0; // Should be true here
             checkoutBtn.textContent = 'Checkout';
             return; // Stop checkout
        }


        // --- Prepare data for Cloud Function ---
        const orderData = {
            items: itemsToProcess
            // Add other relevant data if needed by your function (e.g., currency: 'usd')
        };

        // !!! CRITICAL: Replace with your ACTUAL deployed Cloud Function HTTP URL !!!
        const cloudFunctionUrl = 'https://us-central1-eritrean-bookstore.cloudfunctions.net/processOrder'; // EXAMPLE URL

        if (!cloudFunctionUrl || cloudFunctionUrl.includes('YOUR_PROJECT_ID') || cloudFunctionUrl.includes('processOrder') === false) { // Basic check
             console.error("CRITICAL: Cloud Function URL is not correctly set!");
             orderStatusEl.textContent = 'Checkout configuration error (Function URL). Cannot proceed.';
             orderStatusEl.className = 'error';
             checkoutBtn.disabled = false; // Re-enable
             checkoutBtn.textContent = 'Checkout';
             return;
        }


        try {
            // --- Call the HTTP Cloud Function ---
             orderStatusEl.textContent = 'Connecting to server to create order...';
            const response = await fetch(cloudFunctionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

             orderStatusEl.textContent = 'Validating order with server...'; // Update status

            // --- Handle Function Response ---
            if (!response.ok) {
                // Attempt to parse error details from the function's response body
                let errorDetails = `Server error (${response.status}).`;
                let specificMessage = '';
                try {
                    const errorResponseData = await response.json();
                    console.error("Cloud Function Error Response:", errorResponseData);
                    // Use the specific error message from the function if available
                    specificMessage = errorResponseData.message || (typeof errorResponseData.error === 'string' ? errorResponseData.error : '');
                     errorDetails = specificMessage || errorDetails + ` ${response.statusText || '(No details)'}`;

                      // If specific stock error message received, update UI more clearly
                     if (errorResponseData.error?.includes('stock') || errorResponseData.code === 'out-of-stock') {
                         alert(`Checkout failed: ${errorDetails}. Your cart may need updating.`);
                         fetchBooks(); // Re-fetch books to show potentially updated stock
                         renderCart(); // Re-render cart potentially showing warnings
                     } else {
                          // General server error
                          alert(`Checkout failed: ${errorDetails}. Please try again later.`);
                     }

                } catch (parseError) {
                     // Body wasn't JSON or empty, use status text
                     errorDetails += ` ${response.statusText || '(Could not parse error response)'}`;
                      console.error("HTTP error calling Cloud Function, failed to parse JSON response:", response.status, response.statusText);
                      alert(`Checkout failed: ${errorDetails}. Please try again later.`);
                }
                // Throwing an error here was causing issues, directly update UI instead
                orderStatusEl.textContent = `Checkout failed: ${errorDetails}`;
                orderStatusEl.className = 'error';
                checkoutBtn.disabled = false; // Allow retry
                checkoutBtn.textContent = 'Checkout';
                return; // Stop execution here after handling error
            }

            // --- Success: Initialize Payment Element ---
            const responseData = await response.json();

            // **Crucial Check**: Ensure clientSecret is present in the response
            if (!responseData || !responseData.clientSecret) {
                 console.error("Cloud Function Response missing clientSecret:", responseData);
                 throw new Error("Checkout failed: Invalid response from server (missing payment details)."); // Throw to be caught by catch block
            }

            paymentIntentClientSecret = responseData.clientSecret; // Store the secret globally
            const orderId = responseData.orderId; // Assuming function returns orderId too
            console.log(`Order ${orderId || 'N/A'} initiated by server. Client Secret received.`);


             orderStatusEl.textContent = 'Order ready. Please enter payment details below.';
              orderStatusEl.className = 'info';

            // Initialize the Stripe Payment Element with the received secret
             const initSuccess = await initializePaymentElement(paymentIntentClientSecret);
             if (!initSuccess) {
                 // Error initializing payment element handled inside the function
                  // Re-enable checkout button as payment form failed to show
                  orderStatusEl.textContent = "Failed to load payment form. Please try checkout again."; // Update status
                  orderStatusEl.className = 'error';
                 checkoutBtn.disabled = false;
                 checkoutBtn.textContent = 'Checkout';
             }
             // If initSuccess is true, payment form is shown, checkout button remains disabled


        } catch (error) {
             // Catch network errors during fetch or errors thrown explicitly (like missing clientSecret)
             console.error("Error during handleCheckout function:", error);
             orderStatusEl.textContent = `Checkout error: ${error.message || 'Please check connection and try again.'}`;
             orderStatusEl.className = 'error';
             // Re-enable the checkout button on failure
             checkoutBtn.disabled = false;
             checkoutBtn.textContent = 'Checkout';
        }
    }


    // --- Event Listeners Setup ---
    function setupEventListeners() {
         // Check if essential elements for listeners exist first
         if (!searchInput || !cartToggleButton || !cartCloseButton || !cartOverlay || !checkoutBtn || !paymentForm || !cartItemsContainer ) {
              console.error("Cannot setup event listeners: One or more required DOM elements not found.");
              // Display user-facing error?
              if(booksErrorEl) booksErrorEl.textContent = "Error initializing page interactions.";
              return;
         }

        // Search Input (with Debounce)
        searchInput.addEventListener('input', () => {
            debounce(handleSearch, DEBOUNCE_DELAY);
        });

        // Cart Toggle Button
        cartToggleButton.addEventListener('click', toggleCart);

        // Cart Close Button
        cartCloseButton.addEventListener('click', toggleCart);

        // Cart Overlay Click to Close
        cartOverlay.addEventListener('click', (event) => {
            // Close only if clicking the overlay itself, not its children (the panel)
            if (event.target === cartOverlay) {
                toggleCart();
            }
        });

        // Main Checkout Button (in Cart Panel)
        checkoutBtn.addEventListener('click', handleCheckout);

        // Payment Form Submission
        paymentForm.addEventListener('submit', (event) => {
            event.preventDefault(); // Prevent default form submission
            confirmPayment(); // Call the Stripe confirmation function (already async)
        });

         // Use Event Delegation for Cart Item Controls (+, -, remove)
         cartItemsContainer.addEventListener('click', handleCartItemClick);


         // Listen for Esc key to close cart
         document.addEventListener('keydown', (event) => {
              if (event.key === 'Escape' && cartPanel && cartPanel.classList.contains('open')) {
                   toggleCart();
              }
         });

         console.log("Event listeners setup complete.");
    }

    // --- Initialization on DOM Ready ---
    document.addEventListener('DOMContentLoaded', () => {
        console.log("DOM fully loaded and parsed.");

        // Abort if critical dependencies failed earlier
        if (typeof firebase === 'undefined' || !db) {
             console.error("Aborting initialization: Firebase not available.");
             return; // Stop further execution
        }
         if (!stripe) {
              console.error("Aborting initialization: Stripe not available.");
              // Display a message about payment system failure
              if(orderStatusEl) orderStatusEl.textContent = "Payment system failed to load.";
              return; // Stop further execution
         }


        if (!cacheDOMElements()) { // Cache elements and check if successful
             console.error("Aborting initialization: Failed to cache essential DOM elements.");
              return; // Stop further execution if critical elements are missing
        }


        if (currentYearEl) {
            currentYearEl.textContent = new Date().getFullYear();
        } else {
            console.warn("Element with id 'currentYear' not found.");
        }

        // Initial setup calls
        fetchBooks();      // Fetch books on page load
        updateCartCount(); // Set initial cart count display
        saveCart();        // Ensure checkout button state is correct based on initial cart
        setupEventListeners(); // Setup all event listeners
    });
    // --- CODE END ---

