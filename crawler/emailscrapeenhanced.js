const { chromium } = require('playwright');
const fs = require('fs');
const { parse } = require('url');

async function extractContactInfoFromWebsite(baseUrl) {
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
  
  // Object to store social media links
  const socialMediaLinks = {};
  
  // Array to store potential team member or decision maker names
  const teamMembers = [];
  
  try {
    console.log(`Starting crawl at ${baseUrl}`);
    
    // Set to track visited URLs
    const visitedUrls = new Set();
    // Queue of URLs to visit (starting with the base URL)
    const urlsToVisit = [baseUrl];
    
    // Prioritize team/about pages
    const priorityKeywords = ['team', 'about', 'staff', 'management', 'leadership', 'contact', 'people', 'who-we-are', 'executives'];
    for (const keyword of priorityKeywords) {
      urlsToVisit.push(`${baseUrl}/${keyword}`);
    }
    
    // Process URLs until the queue is empty or we've visited a reasonable number
    const maxUrlsToVisit = 100; // Set a limit to prevent infinite crawling
    let urlsVisited = 0;
    
    // Get the base hostname for domain checking
    const baseHostname = parse(baseUrl).hostname;
    
    // Social media patterns
    const socialMediaPatterns = [
      { name: 'facebook', regex: /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([^\/\s]+)/i },
      { name: 'twitter', regex: /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([^\/\s]+)/i },
      { name: 'linkedin', regex: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in|school)\/([^\/\s]+)/i },
      { name: 'instagram', regex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^\/\s]+)/i },
      { name: 'youtube', regex: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:user|channel|c)\/([^\/\s]+)/i },
      { name: 'tiktok', regex: /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([^\/\s]+)/i },
      { name: 'pinterest', regex: /(?:https?:\/\/)?(?:www\.)?pinterest\.com\/([^\/\s]+)/i },
      { name: 'github', regex: /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s]+)/i }
    ];

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
        
        // Extract social media links
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => ({ href: a.href, text: a.textContent.trim() }));
        });
        
        // Check for social media links
        for (const { href, text } of links) {
          // Check against social media patterns
          for (const platform of socialMediaPatterns) {
            const match = href.match(platform.regex);
            if (match && match[1] && !socialMediaLinks[platform.name]) {
              socialMediaLinks[platform.name] = {
                url: href,
                handle: match[1],
                source_url: currentUrl
              };
            }
          }

          // Process link for internal navigation
          try {
            // Parse the URL to check if it belongs to the same domain
            const parsedUrl = parse(href);
            const linkHostname = parsedUrl.hostname;
            
            // Only add links from the same domain
            if (linkHostname === baseHostname && !visitedUrls.has(href) && !urlsToVisit.includes(href)) {
              // Prioritize team/about pages by putting them at the beginning of the queue
              const lowercasePath = href.toLowerCase();
              if (priorityKeywords.some(keyword => lowercasePath.includes(keyword))) {
                urlsToVisit.unshift(href);
              } else {
                urlsToVisit.push(href);
              }
            }
          } catch (error) {
            console.log(`Error processing link: ${href}`);
          }
        }
        
        // Extract potential team members or decision makers from the page
        // This is more complex and heuristic-based
        const isTeamPage = priorityKeywords.some(keyword => currentUrl.toLowerCase().includes(keyword));
        
        if (isTeamPage) {
          console.log(`Checking for team members on ${currentUrl} (looks like a team page)`);
          
          // Extract potential team members using common patterns
          const potentialTeamMembers = await page.evaluate(() => {
            const results = [];
            
            // Look for common team member patterns
            const nameElements = [];
            
            // Method 1: Check for specific HTML structures that often indicate team members
            document.querySelectorAll('.team-member, .team, .staff, .employee, .profile, .bio, .member, .person, .executive, .leadership')
              .forEach(container => nameElements.push(container));
            
            // Method 2: Check for headings followed by paragraphs (often indicates a person and their bio)
            document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
              const headingText = heading.textContent.trim();
              if (headingText && headingText.split(' ').length <= 4 && 
                  heading.nextElementSibling && 
                  (heading.nextElementSibling.tagName === 'P' || 
                   heading.nextElementSibling.querySelector('p'))) {
                
                // Possible job title (often in paragraph or subheading after name)
                let jobTitle = '';
                if (heading.nextElementSibling) {
                  const nextElement = heading.nextElementSibling;
                  if (nextElement.tagName === 'P' || nextElement.tagName === 'H3' || 
                      nextElement.tagName === 'H4' || nextElement.tagName === 'H5' || 
                      nextElement.tagName === 'SPAN' || nextElement.tagName === 'DIV') {
                    jobTitle = nextElement.textContent.trim().split('\n')[0];
                    // Job titles are typically short, so limit length
                    if (jobTitle.length > 100) jobTitle = jobTitle.substring(0, 100);
                  }
                }
                
                results.push({
                  name: headingText,
                  title: jobTitle || 'Unknown',
                  source: 'heading-pattern'
                });
              }
            });
            
            // Method 3: Look for specific containers with multiple elements
            document.querySelectorAll('.team-grid, .team-container, .team-members, .staff-list, .people-list').forEach(container => {
              // Find all child elements that might be individual team members
              container.querySelectorAll('.member, .profile, .person, .card, .col, > div').forEach(memberEl => {
                const headings = memberEl.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b');
                const paragraphs = memberEl.querySelectorAll('p, span, div');
                
                if (headings.length > 0) {
                  const name = headings[0].textContent.trim();
                  let title = paragraphs.length > 0 ? paragraphs[0].textContent.trim() : 'Unknown';
                  // Clean up title
                  if (title.length > 100) title = title.substring(0, 100);
                  
                  results.push({
                    name,
                    title: title || 'Unknown',
                    source: 'container-pattern'
                  });
                }
              });
            });
            
            return results;
          });
          
          if (potentialTeamMembers.length > 0) {
            console.log(`Found ${potentialTeamMembers.length} potential team members on ${currentUrl}`);
            potentialTeamMembers.forEach(member => {
              // Add source URL
              member.source_url = currentUrl;
              teamMembers.push(member);
            });
          }
        }
        
      } catch (error) {
        console.error(`Error visiting ${currentUrl}:`, error.message);
      }
    }
    
    console.log('Validating team member names...');
    
    // Validate names using intelligent name validation
    const validatedTeamMembers = [];
    
    teamMembers.forEach(member => {
      if (isLikelyPersonName(member.name)) {
        validatedTeamMembers.push(member);
      } else {
        console.log(`Filtered out unlikely name: "${member.name}"`);
      }
    });
    
    console.log(`Filtered out ${teamMembers.length - validatedTeamMembers.length} unlikely names.`);
    
    // Clean up validated team members data (remove duplicates based on name)
    const uniqueTeamMembers = {};
    validatedTeamMembers.forEach(member => {
      const normalizedName = member.name.toLowerCase();
      if (!uniqueTeamMembers[normalizedName]) {
        uniqueTeamMembers[normalizedName] = member;
      }
    });
    
    // Create JSON output format
    const jsonOutput = {
      website: baseUrl,
      emails: Object.entries(uniqueEmails).map(([email, url]) => ({
        email,
        source_url: url
      })),
      social_media: Object.values(socialMediaLinks),
      team_members: Object.values(uniqueTeamMembers)
    };
    
    // Write JSON file
    fs.writeFileSync('contact_info.json', JSON.stringify(jsonOutput, null, 2));
    
    console.log(`Crawl completed. Visited ${urlsVisited} URLs.`);
    console.log(`All email results saved to output.csv`);
    console.log(`Comprehensive contact information saved to contact_info.json`);
    console.log(`Found ${Object.keys(uniqueEmails).length} unique email addresses.`);
    console.log(`Found ${Object.keys(socialMediaLinks).length} social media accounts.`);
    console.log(`Found ${Object.keys(uniqueTeamMembers).length} validated team members.`);
    
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

/**
 * Uses multiple heuristics to determine if a string is likely a person's name
 * @param {string} nameString - The string to evaluate
 * @return {boolean} - Whether the string is likely a person's name
 */
function isLikelyPersonName(nameString) {
  if (!nameString) return false;
  
  // Clean up the name string
  const name = nameString.trim();
  
  // Common words that are typically not part of person names
  const nonNameKeywords = [
    // Generic marketing terms
    'welcome', 'about', 'contact', 'services', 'products', 'shop', 'blog', 'news',
    'home', 'login', 'register', 'sign up', 'sign in', 'account', 'portfolio',
    'how', 'why', 'what', 'when', 'where', 'faq', 'help', 'support',
    // Months, days, seasons
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'winter', 'spring', 'summer', 'fall', 'autumn',
    // Business terms
    'company', 'business', 'team', 'partners', 'careers', 'jobs', 'industry', 'solutions',
    'mission', 'vision', 'values', 'history', 'testimonials', 'clients', 'customers',
    // Generic website sections
    'main menu', 'navigation', 'header', 'footer', 'sidebar', 'search', 'copyright',
    'privacy', 'terms', 'conditions', 'policy', 'sitemap', 'menu', 'navigation',
    // Communication terms
    'email', 'phone', 'address', 'location', 'message', 'subscribe', 'newsletter',
    // Business entities
    'inc', 'llc', 'corporation', 'corp', 'ltd', 'limited', 'company',
    // Generic content
    'read more', 'learn more', 'click here', 'discover', 'explore', 'view', 'download',
    'image', 'photo', 'picture', 'video', 'gallery', 'slideshow',
    // Technical terms
    'html', 'css', 'javascript', 'php', 'api', 'database', 'server', 'cloud', 'mobile', 'desktop',
    'app', 'application', 'website', 'web', 'site', 'domain', 'page', 'host', 'hostname',
    // Social media
    'facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'pinterest', 'tiktok', 'social',
    'follow', 'like', 'share', 'comment', 'post',
    // Company departments
    'sales', 'marketing', 'finance', 'accounting', 'operations', 'production', 'logistics',
    'shipping', 'returns', 'warranty', 'legal', 'compliance', 'regulations',
    // Page types
    'overview', 'details', 'features', 'specifications', 'requirements', 'instructions',
    'benefits', 'advantages', 'features', 'options', 'alternatives'
  ];
  
  // Check for common non-name keywords
  const lowerName = name.toLowerCase();
  for (const keyword of nonNameKeywords) {
    if (lowerName === keyword || lowerName.includes(` ${keyword} `)) {
      return false;
    }
  }
  
  // Check basic name patterns
  
  // 1. Names typically don't have more than 5 words
  if (name.split(' ').length > 5) {
    return false;
  }
  
  // 2. Names typically don't have many special characters
  const specialCharCount = (name.match(/[^a-zA-Z0-9\s\-'\.]/g) || []).length;
  if (specialCharCount > 2) {
    return false;
  }
  
  // 3. Names typically have at least 2 characters
  if (name.length < 2) {
    return false;
  }
  
  // 4. Names typically start with a capital letter
  if (!/^[A-Z]/.test(name)) {
    return false;
  }
  
  // 5. Most names have at least two words (first and last name)
  if (!name.includes(' ')) {
    // It's a single word, which could be just a first name, or it could be something else
    // Single words that are very long are less likely to be names
    if (name.length > 15) {
      return false;
    }
  }
  
  // 6. Names don't typically start with numbers
  if (/^\d/.test(name)) {
    return false;
  }
  
  // 7. Names with excessive numbers anywhere are less likely to be actual names
  const digitCount = (name.match(/\d/g) || []).length;
  if (digitCount > 1) {
    return false;
  }
  
  // 8. Names don't typically have URLs or email addresses
  if (name.includes('http') || name.includes('www.') || name.includes('@')) {
    return false;
  }
  
  // 9. Names with all caps or all lowercase are suspicious
  if (name === name.toUpperCase() && name.length > 3) {
    return false;
  }
  
  // 10. Very long words within a name are suspicious
  const hasVeryLongWord = name.split(' ').some(word => word.length > 15);
  if (hasVeryLongWord) {
    return false;
  }
  
  // Final check: Does it look like a typical name format?
  // e.g., "First Last", "First M. Last", "Dr. First Last", etc.
  const namePattern = /^(?:[A-Z][a-z]+\.?\s)*[A-Z][a-z]+(?:\s[A-Z]\.?)?(?:\s[A-Z][a-z]+)*$/;
  if (namePattern.test(name)) {
    return true;
  }
  
  // If we're still here, apply a more lenient check
  // A sequence of capitalized words with optional initials
  const lenientNamePattern = /^[A-Z][a-z]*(?:\s[A-Z][a-z]*)*$/;
  return lenientNamePattern.test(name);
}

// Get the website URL from command line arguments
const websiteUrl = process.argv[2];

// Run the function with the provided URL
extractContactInfoFromWebsite(websiteUrl);