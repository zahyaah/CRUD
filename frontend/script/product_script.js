async function fetchProducts() {
    try {
        const fetchProduct = await fetch("/products", {
            method: "GET"
        });
        const data = await fetchProduct.json();
        const table = document.querySelector("table");
    
        data.forEach(product => {
            const productItem = document.createElement("tr");
            const idTd = document.createElement("td"); 
            idTd.textContent = product.id;
            productItem.appendChild(idTd);
    
            const nameTd = document.createElement("td");
            nameTd.textContent = product.name; 
            productItem.appendChild(nameTd);
    
            const descTd = document.createElement("td");
            descTd.textContent = product.description;
            productItem.appendChild(descTd);
    
            const priceTd = document.createElement('td');
            priceTd.textContent = product.price; 
            productItem.appendChild(priceTd);
    
            const catTd = document.createElement("td");
            catTd.textContent = product.category; 
            productItem.appendChild(catTd);
    
            const stockTd = document.createElement("td");
            stockTd.textContent = product.stock_quantity;
            productItem.appendChild(stockTd);
    
            const manTd = document.createElement("td");
            manTd.textContent = product.manufacturer; 
            productItem.appendChild(manTd);
    
            const relTd = document.createElement("td");
            relTd.textContent = product.release_date.slice(0, 10); 
            productItem.appendChild(relTd);
    
            const ratingTd = document.createElement("td");
            ratingTd.textContent = product.rating;
            productItem.appendChild(ratingTd);
    
            table.appendChild(productItem);
        });
    }
    catch (error) {
        console.error("Error fetching products:", error);
    }
}

window.onload = fetchProducts;