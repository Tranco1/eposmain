const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const app = express();
const port = 3000;

// Database connection
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "myerp",
  password: "aass",
  port: 5432,
});

// Configure file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dealerId = req.session.user.dealer_id;
    const uploadPath = path.join(__dirname, "public", "img", String(dealerId));

    // Ensure dealer folder exists
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
//    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
//    cb(null, uniqueSuffix + path.extname(file.originalname));
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    cb(null, safeName);
  },
});

const upload = multer({ storage });

// Make /public accessible to browser
app.use(express.static(path.join(__dirname, "public")));



// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");

app.use(
  session({
    secret: "mysecretkey",
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware to protect routes
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

/* ================= AUTH ================= */
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

  if (result.rows.length === 0) {
    return res.send("Invalid email or password. <a href='/login'>Try again</a>");
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.send("Invalid email or password. <a href='/login'>Try again</a>");
  }

  req.session.user = { id: user.id, name: user.name, email: user.email, dealer_id:user.dealer_id };
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});




/* ================= MAIN DASHBOARD ================= */
app.get("/", requireLogin, async (req, res) => {
  const { id, dealer_id } = req.session.user;

  // Only this user
  const users = await pool.query(
    `SELECT id, name, email, dealer_id 
     FROM users WHERE id=$1`,
    [id]
  );

  // Only products for this dealer
  const products = await pool.query(
   `SELECT products.*, d.legalname as dealer_name, c.cname as category_name
     FROM products
     JOIN category c ON products.category = c.id
     LEFT JOIN dealers d ON products.dealer_id = d.id
     WHERE products.dealer_id=$1
     ORDER BY products.id ASC`,
    [dealer_id]
  );

  // Only orders for this dealer
  const orders = await pool.query(
    `SELECT orders.*, users.name as user
     FROM orders
     JOIN users ON orders.user_id = users.id
     WHERE orders.dealer_id=$1
     ORDER BY orders.order_id ASC`,
    [dealer_id]
  );

  // Only this dealer
  const dealers = await pool.query(
    "SELECT * FROM dealers WHERE id=$1",
    [dealer_id]
  );

  // Only this dealer
  const category = await pool.query(
    "SELECT * FROM category WHERE dealer_id=$1",
    [dealer_id]
  );



  res.render("index", {
    users: users.rows,
    products: products.rows,
    orders: orders.rows,
    dealers: dealers.rows,
    category: category.rows
  });
});


/* ================= USERS ================= */
app.post("/users/add", requireLogin, async (req, res) => {
  const { name, email, password, dealer_id } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  await pool.query(
    "INSERT INTO users (name, email, password, dealer_id) VALUES ($1, $2, $3, $4)",
    [name, email, hashed, dealer_id || null]
  );
  res.redirect("/");
});

app.get("/users/edit/:id", requireLogin, async (req, res) => {
  const user = (await pool.query("SELECT * FROM users WHERE id=$1", [req.params.id])).rows[0];
  const dealers = (await pool.query("SELECT * FROM dealers ORDER BY id ASC")).rows;
  res.render("edit-user", { user, dealers });
});

app.post("/users/update/:id", requireLogin, async (req, res) => {
  const { name, email, password, dealer_id } = req.body;
  if (password && password.trim() !== "") {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      "UPDATE users SET name=$1, email=$2, password=$3, dealer_id=$4 WHERE id=$5",
      [name, email, hashed, dealer_id || null, req.params.id]
    );
  } else {
    await pool.query(
      "UPDATE users SET name=$1, email=$2, dealer_id=$3 WHERE id=$4",
      [name, email, dealer_id || null, req.params.id]
    );
  }
  res.redirect("/");
});

app.get("/users/delete/:id", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
  res.redirect("/");
});

/* ================= PRODUCTS ================= */
app.post("/products/add", requireLogin, async (req, res) => {
  const { name, price, dealer_id, desc2, img, category } = req.body;
  await pool.query(
    "INSERT INTO products (name, price, dealer_id, desc2, img, category) VALUES ($1, $2, $3, $4, $5, $6)",
    [name, price, dealer_id, desc2, img, category || null]
  );
  res.redirect("/");
});

app.get("/products/edit/:id", requireLogin, async (req, res) => {
  const product = (await pool.query("SELECT * FROM products WHERE id=$1", [req.params.id])).rows[0];
  const dealers = (await pool.query("SELECT * FROM dealers ORDER BY id ASC")).rows;
  const category = (await pool.query("SELECT * FROM category ORDER BY id ASC")).rows;
  res.render("edit-product", { product, dealers, category });
});

app.post("/products/update/:id", requireLogin,
upload.single("image"),
async (req, res) => {
  const { name, price, dealer_id, desc2, img, category } = req.body;
  // Only allow updating within your dealer scope
  const productCheck = await pool.query(
    "SELECT * FROM products WHERE id=$1 AND dealer_id=$2",
    [req.params.id, dealer_id]
  );
  if (productCheck.rows.length === 0) {
    return res.send("Unauthorized or product not found.");
  }

  let imagePath = productCheck.rows[0].img;

  if (req.file) {
    imagePath = `/img/${dealer_id}/${req.file.filename}`;
//        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
//        imagePath = `/img/${dealer_id}/${safeName}`;
  }


  await pool.query(
    "UPDATE products SET name=$1, price=$2, dealer_id=$3, desc2=$4, img=$5 WHERE id=$6",
    [name, price, dealer_id || null, desc2, imagePath, req.params.id]
  );
  res.redirect("/");
});

app.get("/products/delete/:id", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
  res.redirect("/");
});

/* ================= ORDERS ================= */
app.post("/orders/add", requireLogin, async (req, res) => {
  const { user_id, customer_name, order_date, total, dealer_id } = req.body;
  await pool.query(
    "INSERT INTO orders (user_id, customer_name, order_date, total, dealer_id) VALUES ($1, $2, $3, $4, $5)",
    [user_id, customer_name, order_date, total, dealer_id || null]
  );
  res.redirect("/");
});

app.get("/orders/edit/:id", requireLogin, async (req, res) => {
  const order = (await pool.query("SELECT * FROM orders WHERE order_id=$1", [req.params.id])).rows[0];
  const users = (await pool.query("SELECT * FROM users ORDER BY id ASC")).rows;
  const products = (await pool.query("SELECT * FROM products ORDER BY id ASC")).rows;
  const dealers = (await pool.query("SELECT * FROM dealers ORDER BY id ASC")).rows;
  res.render("edit-order", { order, users, products, dealers });
});

app.post("/orders/update/:id", requireLogin, async (req, res) => {
  const { user_id, product_id, quantity, dealer_id } = req.body;
  await pool.query(
    "UPDATE orders SET user_id=$1, product_id=$2, quantity=$3, dealer_id=$4 WHERE id=$5",
    [user_id, product_id, quantity, dealer_id || null, req.params.id]
  );
  res.redirect("/");
});

app.get("/orders/delete/:id", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM orders WHERE id=$1", [req.params.id]);
  res.redirect("/");
});

/* ================= DEALERS ================= */
app.post("/dealers/add", requireLogin, async (req, res) => {
  const { legalname, tname, address } = req.body;
  await pool.query(
    "INSERT INTO dealers (legalname, tname, address) VALUES ($1, $2, $3)",
    [legalname, tname, address]
  );
  res.redirect("/");
});

app.get("/dealers/edit/:id", requireLogin, async (req, res) => {
  const dealer = (await pool.query("SELECT * FROM dealers WHERE id=$1", [req.params.id])).rows[0];
  res.render("edit-dealer", { dealer });
});

app.post("/dealers/update/:id", requireLogin, async (req, res) => {
  const { legalname, tname, address } = req.body;
  await pool.query(
    "UPDATE dealers SET legalname=$1, tname=$2, address=$3 WHERE id=$4",
    [legalname, tname, address, req.params.id]
  );
  res.redirect("/");
});

app.get("/dealers/delete/:id", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM dealers WHERE id=$1", [req.params.id]);
  res.redirect("/");
});

/* ================= CATEGORY ================= */
app.post("/category/add", requireLogin, async (req, res) => {
  const { sortcode, cname, dealer_id } = req.body;
  await pool.query(
    "INSERT INTO category (sortcode, cname, dealer_id) VALUES ($1, $2, $3)",
    [sortcode, cname, dealer_id]
  );
  res.redirect("/");
});

app.get("/category/edit/:id", requireLogin, async (req, res) => {
  const category = (await pool.query("SELECT * FROM category WHERE id=$1", [req.params.id])).rows[0];
  const dealers = (await pool.query("SELECT * FROM dealers ORDER BY id ASC")).rows;
  res.render("edit-category", { category, dealers });
});

app.post("/category/update/:id", requireLogin, async (req, res) => {
  const { sortcode, cname, dealer_id } = req.body;
  await pool.query(
    "UPDATE category SET sortcode=$1, cname=$2, dealer_id=$3 WHERE id=$4",
    [sortcode, cname, dealer_id, req.params.id]
  );
  res.redirect("/");
});

app.get("/category/delete/:id", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM category WHERE id=$1", [req.params.id]);
  res.redirect("/");
});


/* ================= START ================= */
app.listen(port, () => {
  console.log(`App running at http://localhost:${port}`);
});
