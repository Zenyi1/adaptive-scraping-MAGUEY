const { chromium } = require('playwright');
const fs = require('fs');
const { parse } = require('url');

async function extractEmailsFromWebsite(baseUrl) {
  // Validate the input URL
  if (!baseUrl) {
    console.error('Error: Please provide a website URL as a command line argument.');
    console.error('Example: node script.js https://www.example.com');
    process.exit(1);
  }

  // Add protocol if missing
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }

  // Validate URL format
  try {
    new URL(baseUrl);
  } catch (e) {
    console.error('Error: Invalid URL format. Please provide a valid URL.');
    process.exit(1);
  }

  console.log(`Target website: ${baseUrl}`);

  // Launch a browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Create CSV file and write header
  fs.writeFileSync('output.csv', 'URL,Email\n');
  
  // Object to store first instances of unique emails
  const uniqueEmails = {};
  
  try {
    console.log(`Starting crawl at ${baseUrl}`);
    
    // Set to track visited URLs
    const visitedUrls = new Set();
    // Queue of URLs to visit (starting with the base URL)
    const urlsToVisit = [baseUrl];
    
    // Process URLs until the queue is empty or we've visited a reasonable number
    const maxUrlsToVisit = 100; // Set a limit to prevent infinite crawling
    let urlsVisited = 0;
    
    // Get the base hostname for domain checking
    const baseHostname = parse(baseUrl).hostname;
    
    while (urlsToVisit.length > 0 && urlsVisited < maxUrlsToVisit) {
      const currentUrl = urlsToVisit.shift();
      
      // Skip if we've already visited this URL
      if (visitedUrls.has(currentUrl)) {
        continue;
      }
      
      console.log(`Visiting ${currentUrl} (${urlsVisited + 1}/${maxUrlsToVisit})`);
      
      try {
        // Navigate to the URL
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => console.log('Timeout waiting for network idle, continuing anyway...'));
        
        visitedUrls.add(currentUrl);
        urlsVisited++;
        
        // Extract emails from the current page
        const content = await page.content();
        const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
        const emails = content.match(emailRegex) || [];
        
        // Remove duplicates from this page
        const pageUniqueEmails = [...new Set(emails)];
        
        // Write findings to CSV
        if (pageUniqueEmails.length > 0) {
          console.log(`Found ${pageUniqueEmails.length} email(s) on ${currentUrl}`);
          pageUniqueEmails.forEach(email => {
            // Add to CSV
            fs.appendFileSync('output.csv', `"${currentUrl}","${email}"\n`);
            
            // Store first occurrence of each unique email for JSON output
            if (!uniqueEmails[email]) {
              uniqueEmails[email] = currentUrl;
            }
          });
        } else {
          console.log(`No emails found on ${currentUrl}`);
        }
        
        // Find all links on the current page
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href && href.trim() !== '' && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:'));
        });
        
        // Process found links
        for (const link of links) {
          try {
            // Parse the URL to check if it belongs to the same domain
            const parsedUrl = parse(link);
            const linkHostname = parsedUrl.hostname;
            
            // Only add links from the same domain
            if (linkHostname === baseHostname && !visitedUrls.has(link) && !urlsToVisit.includes(link)) {
              urlsToVisit.push(link);
            }
          } catch (error) {
            console.log(`Error processing link: ${link}`);
          }
        }
      } catch (error) {
        console.error(`Error visiting ${currentUrl}:`, error.message);
      }
    }
    
    // Create JSON output format
    const jsonOutput = Object.entries(uniqueEmails).map(([email, url]) => ({
      email,
      source_url: url
    }));
    
    // Write JSON file
    fs.writeFileSync('unique_emails.json', JSON.stringify(jsonOutput, null, 2));
    
    console.log(`Crawl completed. Visited ${urlsVisited} URLs.`);
    console.log(`All results saved to output.csv`);
    console.log(`Unique emails (first instances) saved to unique_emails.json`);
    console.log(`Found ${Object.keys(uniqueEmails).length} unique email addresses.`);
    
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

// Get the website URL from command line arguments
const websiteUrl = process.argv[2];

// Run the function with the provided URL
extractEmailsFromWebsite(websiteUrl);