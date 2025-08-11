import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { Pool } from "pg";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Function to run the actual scrape and update the database
const runScrapeJob = async (store, jobId, dbPool) => {
  console.log(`Starting scrape for jobId: ${jobId}`);
  const walmartUrl = `https://www.walmart.com/browse/grocery/produce/?povid=globalnav_dept_4044_Produce&ebt_eligible=true`;
  
  try {
    const response = await axios.get("https://app.scrapingbee.com/api/v1/", {
      params: {
        api_key: process.env.SCRAPINGBEE_API_KEY,
        url: walmartUrl,
        cookies: `store-search-session-marker=${encodeURIComponent(JSON.stringify({ id: store }))}`,
        wait_for: ".pa0-xl",
        premium_proxy: true,
      },
      timeout: 90000 // Increased timeout for the background job
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
      throw new Error("No items were scraped from the page.");
    }

    // On success, update the job in the database with the results
    await dbPool.query(
      "UPDATE scrape_jobs SET status = $1, results = $2, updated_at = NOW() WHERE job_id = $3",
      ["complete", JSON.stringify(items), jobId]
    );
    console.log(`Successfully completed job: ${jobId}`);

  } catch (error) {
    const errorMessage = error.response ? error.response.data : error.message;
    console.error(`Failed to scrape for job ${jobId}:`, errorMessage);
    // On failure, update the job in the database with a failed status
    await dbPool.query(
      "UPDATE scrape_jobs SET status = $1, updated_at = NOW() WHERE job_id = $2",
      ["failed", jobId]
    );
  }
};

// Main endpoint to START a scrape job
app.get("/scrape", (req, res) => {
  const { store, jobId } = req.query;

  if (!jobId || !store) {
    return res.status(400).send("A store ID and jobId are required.");
  }

  // Immediately respond to the caller that the job has been accepted
  res.status(202).send("Scrape job accepted.");

  // Initialize the database pool
  const dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  // Start the long-running scrape job in the background and DO NOT wait for it to finish
  runScrapeJob(store, jobId, dbPool);
});

app.listen(PORT, () => {
  console.log(`Scraper service listening on port ${PORT}`);
});
