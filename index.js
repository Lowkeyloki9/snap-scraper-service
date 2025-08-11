import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

// 1. Initialize the server
const app = express();
// Render provides a PORT environment variable. We default to 3001 for local testing.
const PORT = process.env.PORT || 3001;

// 2. Enable CORS
// This allows your Vercel frontend to make requests to this server
app.use(cors());

// 3. Define the main scraping route
app.get("/scrape", async (req, res) => {
  const { store } = req.query; // Get the store number from the URL query (e.g., /scrape?store=1234)
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Scraping API key is not configured on the server." });
  }
  if (!store || !/^\d+$/.test(store)) {
    return res.status(400).json({ error: "A valid numeric store ID is required." });
  }

  const walmartUrl = `https://www.walmart.com/browse/grocery/produce/?povid=globalnav_dept_4044_Produce&ebt_eligible=true`;
  
  try {
    const response = await axios.get("https://app.scrapingbee.com/api/v1/", {
      params: {
        api_key: apiKey,
        url: walmartUrl,
        cookies: `store-search-session-marker=${encodeURIComponent(JSON.stringify({ id: store }))}`,
        wait_for: ".pa0-xl",
        premium_proxy: true,
      },
      timeout: 55000,
    });

    const $ = cheerio.load(response.data);
    const items = [];
    $("div[data-item-id]").each((i, el) => {
      if (i >= 15) return false;
      
      const name = $(el).find("span[data-automation-id=\"product-title\"]").text().trim();
      const price = $(el).find("[data-automation-id=\"product-price\"] .f2").text().trim();
      const size = $(el).find("div[data-automation-id=\"product-size\"]").text().trim() || "N/A";
      
      if (name && price) {
        items.push({ name, price, size, availability: "In Stock" });
      }
    });
    
    if (items.length === 0) {
      console.warn("No items were scraped. The page layout may have changed.");
      return res.status(500).json({ error: "Failed to parse any items from the page." });
    }

    return res.status(200).json(items);

  } catch (error) {
    console.error("Scraping failed:", error.response ? error.response.data : error.message);
    return res.status(500).json({ error: "The scraping service failed to retrieve the page." });
  }
});

// 4. Start the server
app.listen(PORT, () => {
  console.log(`Scraper service listening on port ${PORT}`);
});
