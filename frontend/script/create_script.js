document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("product-form");

    form.addEventListener("submit", async (event) => {
        event.preventDefault(); 

        const id = document.getElementById("id").value;
        const name = document.getElementById("name").value;
        const description = document.getElementById("desc").value;
        const price = document.getElementById("price").value;
        const category = document.getElementById("cat").value;
        const stock_quantity = document.getElementById("stock").value;
        const manufacturer = document.getElementById("manf").value;
        const release_date = document.getElementById("rel").value;
        const rating = document.getElementById("rating").value;


        if (!id || !name || !description || !price || !category || !stock_quantity || !manufacturer || !release_date || !rating) {
            alert("Please fill in all fields.");
            return;
        }

        if (isNaN(parseInt(id)) || isNaN(parseFloat(price)) || isNaN(parseInt(stock_quantity)) || isNaN(parseFloat(rating))) {
            alert("ID, Price, Stock Quantity, and Rating must be valid numbers.");
            return;
        }

        if (parseFloat(price) <= 0) {
            alert("Price must be a positive number.");
            return;
        }

        if (parseInt(stock_quantity) < 0) {
            alert("Stock Quantity must be a non-negative number.");
            return;
        }

        if (parseFloat(rating) < 1 || parseFloat(rating) > 5) {
            alert("Rating must be between 1 and 5.");
            return;
        }

        if (isNaN(Date.parse(release_date))) {
            alert("Please enter a valid release date.");
            return;
        }

        const productData = {
            id: parseInt(id),
            name: name,
            description: description,
            price: parseFloat(price),
            category: category,
            stock_quantity: parseInt(stock_quantity),
            manufacturer: manufacturer,
            release_date: release_date,
            rating: parseFloat(rating)
        };

        try {
            const response = await fetch("/products", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(productData)
            });

            const result = await response.json();
            if (response.ok) {
                alert(result.Success); 
                window.location.href = "../product.html";
                form.reset(); 
            } else {
                alert(result.Error); 
            }
        } catch (error) {
            console.error("Error creating product:", error);
            alert("An unexpected error occurred. Please try again later.");
        }
    });
});
