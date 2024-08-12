const express = require("express");
const mysql = require("mysql2");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

// from .env
const PORT = process.env.PORT; 
const USER = process.env.ROOT; 
const HOST = process.env.HOST; 
const PASSWORD = process.env.PASSWORD; 
const DATABASE = process.env.DATABASE; 

// middleware
const app = express(); 
app.use(express.json());
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "../frontend")))

// database connection
const connection = mysql.createConnection({
    user: USER,
    host: HOST, 
    password: PASSWORD,
    database: DATABASE
})

connection.connect(err => {
    if (err) {
        console.log("Can't connect to the database");
        return; 
    }
    console.log("Connection established successfully!");
})

// home page?
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/product.html"));
});


// GET Method: Fetch all the rows of the table products
app.get("/products", (req, res) => {
    connection.query("SELECT * FROM PRODUCT", (err, rows) => {
        if (err) 
            return res.status(500).send({"Error": "Internal Server Error"});
            
        if (rows.length === 0) 
            return res.status(410).send({"Error": "Resource not available."});
        
        res.status(200).send(rows);
    });
});

// GET Method: Fetch a row having a particular ID
app.get("/products/:id", (req, res) => {
    let id = parseInt(req.params.id);

    connection.query("SELECT * FROM PRODUCT WHERE id = ?", [id], (err, rows) => {
        if (err) 
            return res.status(500).send({"Error": "Internal Server Error"});
            
        if (rows.length === 0) 
            return res.status(410).send({"Error": "Resource not available."});
        
        res.status(200).send(rows);
    });
});


// POST Method: Create a product
app.post("/products", (req, res) => {
    const { id, name, description, price, category, stock_quantity, manufacturer, release_date, rating } = req.body; 
    // if (req.body.length > 9)
    //     return res.status(400).send({"Error": "Added extra fields"});
    
    connection.query("INSERT INTO PRODUCT (id, name, description, price, category, stock_quantity, manufacturer, release_date, rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [parseInt(id), name, description, price, category, stock_quantity, manufacturer, release_date, parseFloat(rating)], 
        (err, _) => {
            if (err)
                return res.status(500).send({"Error": "Internal Server Error"});
            return res.status(201).send({"Success": "Inserted successfully."});
        }
    )
})


// PUT Method: Updata a product with a particular ID
app.put("/products/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const {name, description, price, category, stock_quantity, manufacturer, release_date, rating} = req.body;
    if (req.body.length > 8)
        return res.status(400).send({"Error": "Added extra fields"});

    connection.query("UPDATE PRODUCT SET name = ?, description = ?, price = ?, category = ?, stock_quantity = ?, manufacturer = ?, release_date = ?, rating = ? WHERE id = ?",
        [name, description, price, category, stock_quantity, manufacturer, release_date, parseFloat(rating), id],
        (err, _) => {
            if (err)
                return res.status(500).send({"Error": "Internal Server Error"});
            return res.status(200).send({"Success": `Updated product with ID ${id}.`});
        }
    )
})


// DELETE Method: Delete a product with a particular ID
app.delete("/products/:id", (req, res) => {
    const id = parseInt(req.params.id);

    connection.query("DELETE FROM product WHERE id = ?",
        [id],
        (err, rows) => {
            if (err)
                return res.status(500).send({"Error": "Internal Server Error"});

            if (rows.affectedRows === 0)
                return res.status(404).send({"Error": `Product with ID ${id} does not exist.`});

            return res.status(200).send({"Success": `Deleted product with ID ${id}.`});
        }
    )
})


app.get("/product.html", (req, res) => {
    fs.readFile("../frontend/product.html", "utf-8", (err, contents) => {
        if (err)
            return res.status(500).send({"Error": "Internal Server Error"});
        
        const p = document.createElement("p");
        p.textContent = contents; 
        document.appendChild(p);
        
        return res.send(contents);
    })
})



app.listen(PORT, () => console.log(`Server running on ${PORT}`));