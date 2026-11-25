// =================================
// NIZZY HAIR BEAUTY APP
// =================================

const SUPABASE_URL = "https://ycajmulrmbappkztpvoz.supabase.co";

const SUPABASE_KEY = "sb_publishable_wm7iVlrgQi5wrPp23H1TlA_TwIKyEBJ";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);


// =================================
// SERVICE WORKER
// =================================

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js")
            .then(() => console.log("Nizzy app is ready"))
            .catch(error => console.error("Service worker error:", error));
    });
}


// =================================
// PRICE FORMATTING
// =================================

function formatNaira(amount) {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0
    }).format(amount);
}


// =================================
// HTML SECURITY
// =================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}


// =================================
// LOAD PRODUCTS FROM SUPABASE
// =================================

async function loadProducts(category = null) {

    const productGrid = document.getElementById("productGrid");

    try {

        let query = supabaseClient
            .from("products")
            .select("*")
            .eq("is_active", true);

        if (category === "Closures & Frontals") {

            query = query.or(
                "category.ilike.%closure%,category.ilike.%frontal%"
            );

        } else if (category) {

            query = query.ilike("category", `%${category}%`);

        }

        const { data, error } = await query.order(
            "created_at",
            { ascending: false }
        );

        if (error) throw error;

        if (!data || data.length === 0) {

            productGrid.innerHTML =
                "<p class='loading-message'>Our collections are being updated. Please check back soon.</p>";

            return;
        }

        window.nizzyProducts = data;

        productGrid.innerHTML = data.map((product, index) => `

            <div class="product-card">

                <img
                    src="${escapeHTML(product.image_url || "")}"
                    alt="${escapeHTML(product.name)}"
                    loading="lazy"
                >

                <div class="product-info">

                    <h3>${escapeHTML(product.name)}</h3>

                    <p class="product-price">
                        ${formatNaira(product.price_ngn)}
                    </p>

                    <button
                        class="product-button"
                        onclick="openProduct(${index})"
                    >
                        View Product
                    </button>

                </div>

            </div>

        `).join("");

    } catch (error) {

        console.error("Product loading error:", error);

        productGrid.innerHTML =
            "<p class='loading-message'>Unable to load products. Please check your internet connection.</p>";

    }

}


// =================================
// PRODUCT DETAILS
// =================================

let selectedProduct = null;


function openProduct(index) {

    selectedProduct = window.nizzyProducts[index];

    document.getElementById("detailImage").src =
        selectedProduct.image_url || "";

    document.getElementById("detailName").textContent =
        selectedProduct.name;

    document.getElementById("detailDescription").textContent =
        selectedProduct.description ||
        "Beautiful premium hair from Nizzy Hair Beauty.";

    const lengthSelect = document.getElementById("detailLength");

    lengthSelect.innerHTML =
        '<option value="">Choose length</option>';

    const lengths = selectedProduct.available_lengths || [];

    lengths.forEach(length => {

        const option = document.createElement("option");

        option.value = length;

        option.textContent = length + " inches";

        lengthSelect.appendChild(option);

    });

    document.getElementById("detailPrice").textContent =
        formatNaira(selectedProduct.price_ngn);

    document.getElementById("detailQuantity").value = 1;

    lengthSelect.onchange = updateProductPrice;

    document.getElementById("productModal").style.display = "block";

}


// =================================
// UPDATE PRODUCT PRICE
// =================================

function updateProductPrice() {

    if (!selectedProduct) return;

    const length = document.getElementById("detailLength").value;

    if (!length) {

        document.getElementById("detailPrice").textContent =
            formatNaira(selectedProduct.price_ngn);

        return;
    }

    const prices = selectedProduct.length_prices || {};

    const price = prices[length];

    document.getElementById("detailPrice").textContent =
        formatNaira(price || selectedProduct.price_ngn);

}


// =================================
// CLOSE PRODUCT DETAILS
// =================================

function closeProduct() {

    document.getElementById("productModal").style.display = "none";

}


// =================================
// CATEGORY FILTERING
// =================================

function filterProducts(category) {

    loadProducts(category);

    document.getElementById("featured").scrollIntoView({
        behavior: "smooth"
    });

}


// =================================
// SHOPPING CART STORAGE
// =================================

let cart = [];

try {

    const savedCart = JSON.parse(
        localStorage.getItem("nizzyCart") || "[]"
    );

    cart = Array.isArray(savedCart) ? savedCart : [];

} catch (error) {

    cart = [];

}


// =================================
// SAVE CART
// =================================

function saveCart() {
    localStorage.setItem("nizzyCart", JSON.stringify(cart));
    displayCart();
    displayDrawerCart();
}



// =================================
// UPDATE CART COUNT
// =================================

function updateCartCount() {

    const cartCount = document.getElementById("cartCount");

    if (!cartCount) return;

    const totalItems = cart.reduce(
        (total, item) => total + item.quantity,
        0
    );

    cartCount.textContent = totalItems;

}


// =================================
// ADD PRODUCT TO CART
// =================================

function addToCart() {

    if (!selectedProduct) return;

    const length = document.getElementById("detailLength").value;

    const quantity = parseInt(
        document.getElementById("detailQuantity").value,
        10
    );

    if (
        selectedProduct.available_lengths?.length &&
        !length
    ) {

        alert("Please select a hair length.");

        return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {

        alert("Please enter a valid quantity.");

        return;
    }

    const prices = selectedProduct.length_prices || {};

    const price = Number(
        prices[length] || selectedProduct.price_ngn
    );

    if (!Number.isFinite(price) || price < 0) {

        alert("Unable to determine this product's price. Please try again.");

        return;
    }

    const cartLength = length || "Standard";

    const existingItem = cart.find(item =>
        item.id === selectedProduct.id &&
        item.length === cartLength
    );

    if (existingItem) {

        existingItem.quantity += quantity;

    } else {

        cart.push({

            id: selectedProduct.id,

            name: selectedProduct.name,

            image: selectedProduct.image_url,

            length: cartLength,

            price: price,

            quantity: quantity

        });

    }

    saveCart();

    closeProduct();

    alert("Product added to your cart!");

}


// =================================
// DISPLAY CART
// =================================

function displayCart() {

    const cartItems = document.getElementById("cartItems");

    const subtotalElement = document.getElementById("cartSubtotal");

    if (!cartItems || !subtotalElement) return;

    updateCartCount();

    if (cart.length === 0) {

        cartItems.innerHTML =
            "<p>Your cart is currently empty.</p>";

        subtotalElement.textContent = formatNaira(0);

        return;
    }

    let subtotal = 0;

    cartItems.innerHTML = cart.map((item, index) => {

        subtotal += item.price * item.quantity;

        return `

            <div class="cart-item">

                <img
                    src="${escapeHTML(item.image || "")}"
                    alt="${escapeHTML(item.name)}"
                >

                <div>

                    <h3>${escapeHTML(item.name)}</h3>

                    <p>
                        ${escapeHTML(item.length)}
                        ${item.length === "Standard" ? "" : " inches"}
                    </p>

                    <p>${formatNaira(item.price)}</p>

                    <button onclick="changeQuantity(${index}, -1)">
                        −
                    </button>

                    <span>${item.quantity}</span>

                    <button onclick="changeQuantity(${index}, 1)">
                        +
                    </button>

                    <button onclick="removeFromCart(${index})">
                        Remove
                    </button>

                </div>

            </div>

        `;

    }).join("");

    subtotalElement.textContent = formatNaira(subtotal);

}


// =================================
// CHANGE PRODUCT QUANTITY
// =================================

function changeQuantity(index, amount) {

    if (!cart[index]) return;

    cart[index].quantity += amount;

    if (cart[index].quantity <= 0) {

        cart.splice(index, 1);

    }

    saveCart();

}


// =================================
// REMOVE PRODUCT FROM CART
// =================================

function removeFromCart(index) {

    if (!cart[index]) return;

    cart.splice(index, 1);

    saveCart();

}


// =================================
// CHECKOUT
// =================================

function checkout() {

    if (cart.length === 0) {
        alert("Your shopping cart is empty.");
        return;
    }

    closeCart();

    document
        .getElementById("checkoutModal")
        .classList.add("active");
}


function closeCheckout() {

    document
        .getElementById("checkoutModal")
        .classList.remove("active");
}



// =================================
// START THE APP
// =================================

loadProducts();

displayCart();
// =================================
// SLIDE-IN CART FUNCTIONS
// =================================

function openCart() {
    displayDrawerCart();

    document.getElementById("cartDrawer").classList.add("active");
    document.getElementById("cartOverlay").classList.add("active");
    document.body.classList.add("cart-open");
}

function closeCart() {
    document.getElementById("cartDrawer").classList.remove("active");
    document.getElementById("cartOverlay").classList.remove("active");
    document.body.classList.remove("cart-open");
}


// =================================
// DISPLAY PRODUCTS IN CART DRAWER
// =================================

function displayDrawerCart() {
    const drawerItems = document.getElementById("drawerCartItems");
    const drawerSubtotal = document.getElementById("drawerSubtotal");

    if (!drawerItems || !drawerSubtotal) return;

    if (cart.length === 0) {
        drawerItems.innerHTML = "<p>Your cart is currently empty.</p>";
        drawerSubtotal.textContent = formatNaira(0);
        return;
    }

    let subtotal = 0;

    drawerItems.innerHTML = cart.map((item, index) => {
        subtotal += item.price * item.quantity;

        return `
            <div class="cart-item">

                <img
                    src="${escapeHTML(item.image || "")}"
                    alt="${escapeHTML(item.name)}"
                >

                <div>
                    <h3>${escapeHTML(item.name)}</h3>

                    <p>
                        ${escapeHTML(item.length)}
                        ${item.length === "Standard" ? "" : " inches"}
                    </p>

                    <p>${formatNaira(item.price)}</p>

                    <button onclick="changeQuantity(${index}, -1)">
                        −
                    </button>

                    <span>${item.quantity}</span>

                    <button onclick="changeQuantity(${index}, 1)">
                        +
                    </button>

                    <button onclick="removeFromCart(${index})">
                        Remove
                    </button>
                </div>

            </div>
        `;
    }).join("");

    drawerSubtotal.textContent = formatNaira(subtotal);
}