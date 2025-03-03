const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-writer').createObjectCsvWriter;

const batchSize = 3; // Reduced batch size for stability
const MAX_LEADS = 50;
const MAX_RETRIES = 3;
const PAGE_TIMEOUT = 30000; // 30 seconds
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds

// Get user inputs from command line
const [place, area, rankBy = 'rating'] = process.argv.slice(2);
if (!place || !area) {
    console.error('Usage: node crawlfast.js "<place>" "<area>" "<rankBy (optional)>"');
    console.error('rankBy options: "rating" (default), "reviews", "relevance"');
    process.exit(1);
}

async function launchBrowser() {
    return await chromium.launch({ 
        headless: true,
        args: [
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials',
            '--disable-web-security',
            '--disable-features=BlockInsecurePrivateNetworkRequests'
        ]
    });
}

async function handleCookieConsent(page) {
    try {
        await page.click('button[aria-label="Reject all"]', { timeout: 5000 });
        console.log('Cookie consent handled');
    } catch (error) {
        console.log('No cookie consent dialog found or unable to click');
    }
}

async function scrollToEnd(page, targetText) {
    try {
        // Wait for the results container to load
        await page.waitForSelector('div[role="feed"], div[aria-label*="Results for"]', { timeout: 15000 });

        console.log("Starting to scroll through results...");

        // More robust scrolling that targets the results panel
        return await page.evaluate(async (targetText) => {
            // Find the scrollable results container
            const scrollableContainer = document.querySelector('div[role="feed"]') || 
                                       document.querySelector('div[aria-label*="Results for"]') ||
                                       document.querySelector('.section-scrollbox');
            
            if (!scrollableContainer) {
                console.error("Could not find results container");
                return 0;
            }
            
            // Utility function to check if we've reached the end
            function hasReachedEnd() {
                return document.body.innerText.includes(targetText) || 
                       document.body.innerText.includes("No more results") ||
                       document.body.innerText.includes("End of list");
            }
            
            let previousHeight = 0;
            let currentHeight = scrollableContainer.scrollHeight;
            let scrollCount = 0;
            let stalledCount = 0;
            const maxScrolls = 100; // Increase this for more results
            
            // Keep scrolling until we reach the end or max scrolls
            while (previousHeight !== currentHeight && 
                   scrollCount < maxScrolls && 
                   !hasReachedEnd() && 
                   stalledCount < 5) {
                
                // Store the current height
                previousHeight = currentHeight;
                
                // Scroll down
                scrollableContainer.scrollBy(0, 1000);
                scrollCount++;
                
                // Wait for new content to load
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Get new height
                currentHeight = scrollableContainer.scrollHeight;
                
                // If height didn't change, increment stalled counter
                if (previousHeight === currentHeight) {
                    stalledCount++;
                } else {
                    stalledCount = 0; // Reset if we're still getting new content
                }
                
                // Randomize scroll a bit to seem more human-like
                if (scrollCount % 4 === 0) {
                    // Sometimes scroll back up a bit
                    scrollableContainer.scrollBy(0, -200);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    scrollableContainer.scrollBy(0, 300); // Then continue scrolling down
                }
                
                // Log progress every 10 scrolls
                if (scrollCount % 10 === 0) {
                    console.log(`Scrolled ${scrollCount} times. Current items: ${document.querySelectorAll('a[href^="https://www.google.com/maps/place/"]').length}`);
                }
            }
            
            // Return count of listings found
            return document.querySelectorAll('a[href^="https://www.google.com/maps/place/"]').length;
        }, targetText);
    } catch (error) {
        console.error('Error during scrolling:', error.message);
        return 0;
    }
}

async function extractListingUrls(page) {
    try {
        return await page.evaluate(() => {
            // Target specifically the listing links in the results panel
            const listingElements = document.querySelectorAll('a[href^="https://www.google.com/maps/place/"]');
            
            // Create an array of unique URLs
            const urls = Array.from(listingElements)
                .map(anchor => anchor.href)
                .filter((value, index, self) => {
                    // Filter out duplicate URLs and any that contain "https://www.google.com/maps/place/@"
                    return self.indexOf(value) === index && !value.includes('/maps/place/@');
                });
                
            console.log(`Found ${urls.length} unique place URLs`);
            return urls;
        });
    } catch (error) {
        console.error('Error extracting listing URLs:', error.message);
        return [];
    }
}

async function scrapeDetailsWithRetry(page, url, retries = 0) {
    if (retries >= MAX_RETRIES) {
        console.error(`Failed to scrape ${url} after ${MAX_RETRIES} attempts`);
        return null;
    }

    const context = page.context();
    let newPage;
    
    try {
        // Create a new page for each listing to avoid context issues
        newPage = await context.newPage();
        
        // Set user agent and other headers
        await newPage.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
        });
        
        // Navigate to the URL with timeout
        await newPage.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT 
        });
        
        // Wait for content to load
        await newPage.waitForTimeout(2000);
        
        // Extract title, address, rating, reviews and category using evaluate
        const basicDetails = await newPage.evaluate(() => {
            // More robust XPath and querySelector-based extraction
            const getTextByXPath = (xpath) => {
                try {
                    const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    return element?.innerText || '';
                } catch {
                    return '';
                }
            };

            // Extract title - try multiple selectors
            let title = getTextByXPath('//h1');
            if (!title) {
                const titleElement = document.querySelector('[role="main"] h1, [role="main"] [aria-level="1"]');
                title = titleElement ? titleElement.innerText : '';
            }

            // Extract address - try multiple methods
            let address = '';
            const addressElements = document.querySelectorAll('button[data-item-id^="address"], [data-item-id^="address"], a[href^="https://www.google.com/maps/dir"]');
            if (addressElements.length > 0) {
                address = addressElements[0].innerText;
            }

            // Extract phone
            let phone = '';
            const phoneElements = document.querySelectorAll('button[data-tooltip="Copy phone number"], [data-item-id^="phone:"], a[href^="tel:"]');
            if (phoneElements.length > 0) {
                phone = phoneElements[0].innerText;
            }

            // Extract rating
            let rating = 0;
            let reviewCount = 0;

            // Try multiple ways to get rating
            const ratingElement = document.querySelector('div[role="img"][aria-label*="stars"], span[aria-label*="stars"]');
            if (ratingElement) {
                const ratingText = ratingElement.getAttribute('aria-label') || '';
                const ratingMatch = ratingText.match(/([0-9]\.[0-9]) stars/);
                if (ratingMatch && ratingMatch[1]) {
                    rating = parseFloat(ratingMatch[1]);
                }

                const reviewMatch = ratingText.match(/([0-9,]+) reviews/);
                if (reviewMatch && reviewMatch[1]) {
                    reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
                }
            }

            // If that didn't work, try another approach
            if (rating === 0) {
                const ratingText = document.querySelector('.fontBodyMedium span');
                if (ratingText) {
                    const text = ratingText.innerText;
                    const ratingMatch = text.match(/([0-9]\.[0-9])/);
                    if (ratingMatch && ratingMatch[1]) {
                        rating = parseFloat(ratingMatch[1]);
                    }

                    const reviewMatch = text.match(/([0-9,]+)/);
                    if (reviewMatch && reviewMatch[1]) {
                        reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
                    }
                }
            }

            // Extract text containing business category/type
            const categoryElement = document.querySelector('button[jsaction="pane.rating.category"], [jsaction="pane.rating.category"]');
            const category = categoryElement ? categoryElement.innerText : '';

            return { 
                title, 
                address, 
                phone, 
                rating, 
                reviewCount, 
                category
            };
        });
        
        // Extract website URL specifically using the original selectors
        let website = '';
        try {
            // Use the exact selectors from your original code
            const websiteElements = await newPage.$$('a[data-tooltip="Open website"], a[data-tooltip="Open menu link"]');
            if (websiteElements.length > 0) {
                website = await websiteElements[0].evaluate(el => el.href);
            }
            
            // If that didn't work, try some alternative selectors
            if (!website) {
                const altWebsiteElements = await newPage.$$('a[href^="http"]:not([href^="https://www.google.com"])');
                for (const el of altWebsiteElements) {
                    const href = await el.evaluate(e => e.href);
                    const ariaLabel = await el.evaluate(e => e.getAttribute('aria-label') || '');
                    
                    // Check if this looks like a website link
                    if (href && !href.includes('google.com/maps') && 
                        (ariaLabel.includes('website') || href.includes(basicDetails.title.toLowerCase()))) {
                        website = href;
                        break;
                    }
                }
            }
        } catch (error) {
            console.error(`Error extracting website: ${error.message}`);
        }

        await newPage.close();
        return {
            ...basicDetails,
            website, // Add the website URL to the basic details
            mapUrl: url // Store the Google Maps URL
        };
    } catch (error) {
        // Clean up and retry with exponential backoff
        console.error(`Error scraping ${url}: ${error.message}. Retry ${retries + 1}/${MAX_RETRIES}`);
        
        if (newPage) {
            await newPage.close().catch(() => {});
        }
        
        // Wait longer between retries (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS * Math.pow(2, retries)));
        return await scrapeDetailsWithRetry(page, url, retries + 1);
    }
}

function rankLeads(leads, rankingMethod, searchQuery) {
    // Filter out null entries
    const validLeads = leads.filter(lead => lead !== null);
    const normalizedQuery = searchQuery.toLowerCase();
    
    switch (rankingMethod.toLowerCase()) {
        case 'rating':
            // Rank by rating first, then by number of reviews
            return validLeads.sort((a, b) => {
                if (b.rating === a.rating) {
                    return b.reviewCount - a.reviewCount;
                }
                return b.rating - a.rating;
            });
            
        case 'reviews':
            // Rank by number of reviews
            return validLeads.sort((a, b) => b.reviewCount - a.reviewCount);
            
        case 'relevance':
            // Rank by relevance to search query (simple keyword matching)
            return validLeads.sort((a, b) => {
                const aRelevance = calculateRelevance(a, normalizedQuery);
                const bRelevance = calculateRelevance(b, normalizedQuery);
                
                if (bRelevance === aRelevance) {
                    if (b.rating === a.rating) {
                        return b.reviewCount - a.reviewCount;
                    }
                    return b.rating - a.rating;
                }
                return bRelevance - aRelevance;
            });
            
        default:
            // Default to rating
            return validLeads.sort((a, b) => b.rating - a.rating);
    }
}

function calculateRelevance(lead, query) {
    // Simple relevance calculation - count occurrences of query terms in lead data
    let relevanceScore = 0;
    const queryTerms = query.split(/\s+/);
    
    const leadText = [
        lead.title || '',
        lead.category || '',
        lead.address || ''
    ].join(' ').toLowerCase();
    
    queryTerms.forEach(term => {
        if (leadText.includes(term)) {
            relevanceScore += 1;
        }
    });
    
    // Boost score for higher ratings and more reviews
    relevanceScore += (lead.rating / 5) * 2;
    relevanceScore += Math.min(lead.reviewCount / 100, 3);
    
    return relevanceScore;
}

// Update the writeFiles function to include mapUrl instead of url
async function writeFiles(records) {
    // Write CSV
    const csvPath = path.join(__dirname, 'ranked_leads.csv');
    const writer = csvWriter({
        path: csvPath,
        header: [
            { id: 'rank', title: 'Rank' },
            { id: 'title', title: 'Title' },
            { id: 'address', title: 'Address' },
            { id: 'website', title: 'Website' },
            { id: 'phone', title: 'Phone' },
            { id: 'rating', title: 'Rating' },
            { id: 'reviewCount', title: 'Reviews' },
            { id: 'category', title: 'Category' },
            { id: 'mapUrl', title: 'Google Maps URL' }
        ]
    });
    
    // Add rank to records
    const rankedRecords = records.map((record, index) => ({
        rank: index + 1,
        ...record,
        mapUrl: record.mapUrl || ''
    }));
    
    await writer.writeRecords(rankedRecords);
    console.log(`CSV saved to ${csvPath}`);

    // Write JSON
    const jsonPath = path.join(__dirname, 'ranked_leads.json');
    fs.writeFileSync(jsonPath, JSON.stringify(rankedRecords, null, 2));
    console.log(`JSON saved to ${jsonPath}`);
}

// Update the processBatch function to use mapUrl
async function processBatch(batch, page) {
    const batchRecords = [];
    for (const url of batch) {
        try {
            console.log(`Processing: ${url}`);
            const details = await scrapeDetailsWithRetry(page, url);
            
            if (details) {
                console.log(`Scraped: ${details.title || 'Unknown'} (Rating: ${details.rating}, Reviews: ${details.reviewCount}, Website: ${details.website || 'None'})`);
                batchRecords.push(details);
            }
            
            // Add random delay between requests to avoid detection
            const delay = Math.floor(Math.random() * 1000) + DELAY_BETWEEN_REQUESTS;
            await new Promise(resolve => setTimeout(resolve, delay));
            
        } catch (error) {
            console.error(`Error in processBatch for ${url}: ${error.message}`);
        }
    }
    return batchRecords;
}

(async () => {
    let browser;
    try {
        browser = await launchBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            viewport: { width: 1366, height: 768 }
        });
        
        const page = await context.newPage();
        
        // Construct dynamic URL
        const searchQuery = `${encodeURIComponent(place)}+in+${encodeURIComponent(area)}`;
        console.log(`Searching for: ${place} in ${area}`);
        console.log(`Ranking method: ${rankBy}`);
        
        await page.goto(`https://www.google.com/maps/search/${searchQuery}`, { 
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT
        });

        await handleCookieConsent(page);

        const targetText = "You've reached the end of the list.";
        console.log("Scrolling to load results (this may take some time)...");
        await scrollToEnd(page, targetText);

        const urls = await extractListingUrls(page);
        console.log(`Found ${urls.length} listings`);

        // Process in smaller batches with delays between batches
        const allRecords = [];
        const numBatches = Math.ceil(urls.length / batchSize);

        for (let i = 0; i < numBatches && allRecords.length < MAX_LEADS * 1.5; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, urls.length);
            const batch = urls.slice(start, end);
            
            console.log(`Processing batch ${i + 1}/${numBatches} (URLs ${start + 1}-${end})`);
            const batchRecords = await processBatch(batch, page);
            allRecords.push(...batchRecords);
            
            // Progress update
            console.log(`Progress: ${allRecords.length} places scraped so far`);
            
            // Add delay between batches to reduce detection risk
            if (i < numBatches - 1) {
                const batchDelay = 3000 + Math.random() * 2000;
                console.log(`Waiting ${Math.round(batchDelay/1000)} seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }

        console.log(`Total places scraped: ${allRecords.length}`);
        console.log(`Ranking leads by: ${rankBy}`);
        
        // Rank the leads and get top 50
        const rankedLeads = rankLeads(allRecords, rankBy, `${place} ${area}`).slice(0, MAX_LEADS);
        console.log(`Top ${rankedLeads.length} leads selected`);
        
        await writeFiles(rankedLeads);
        
        console.log("Done! Check ranked_leads.csv and ranked_leads.json for results.");
    } catch (error) {
        console.error("Critical error:", error);
    } finally {
        if (browser) {
            await browser.close().catch(() => console.log("Browser already closed"));
            console.log("Browser closed");
        }
    }
})();