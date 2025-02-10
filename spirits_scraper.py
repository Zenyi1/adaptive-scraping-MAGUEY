import json
import re
from typing import Dict, List
import time
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync
from bs4 import BeautifulSoup

class SpiritsLocationScraper:
    def __init__(self, headless=True, browser_type="chromium"):
        self.headless = headless
        self.browser_type = browser_type
        
    def scrape_location(self, location: str) -> List[Dict]:
        """
        Scrapes spirits retailers and restaurants in the given location.
        Returns a list of businesses with their contact information.
        """
        # Encode location for URL
        encoded_location = location.replace(' ', '+')
        search_urls = [
            f"https://www.yelp.com/search?find_desc=Liquor+Stores&find_loc={encoded_location}",
            f"https://www.google.com/search?q=liquor+stores+in+{encoded_location}"
        ]
        
        businesses = []
        with sync_playwright() as p:
            browser = getattr(p, self.browser_type).launch(headless=self.headless)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            )
            page = context.new_page()
            stealth_sync(page)
            
            for url in search_urls:
                try:
                    # Navigate to the page
                    page.goto(url, wait_until="networkidle")
                    time.sleep(2)  # Allow dynamic content to load
                    
                    # Scroll to load more results
                    for _ in range(3):
                        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                        time.sleep(1)
                    
                    html_content = page.content()
                    if 'yelp.com' in url:
                        businesses.extend(self._parse_yelp_listings(html_content))
                    elif 'google.com' in url:
                        businesses.extend(self._parse_google_listings(html_content))
                        
                except Exception as e:
                    print(f"Error scraping {url}: {str(e)}")
            
            browser.close()
        return businesses

    def _parse_yelp_listings(self, html_content: str) -> List[Dict]:
        """
        Extracts business information from Yelp HTML content.
        """
        soup = BeautifulSoup(html_content, 'html.parser')
        businesses = []
        
        # Find all business listings
        listings = soup.find_all('div', {'class': ['businessName__09f24__EYSZE', 'container__09f24__fZQnf']})
        
        for listing in listings:
            business = {
                'name': None,
                'address': None,
                'phone': None,
                'website': None,
                'source': 'Yelp'
            }
            
            # Extract business name
            name_elem = listing.find('a', {'class': ['css-1m051bw', 'businessName__09f24__EYSZE']})
            if name_elem:
                business['name'] = name_elem.get_text(strip=True)
            
            # Extract address
            address_elem = listing.find('address')
            if address_elem:
                business['address'] = address_elem.get_text(strip=True)
            
            # Extract phone number (if visible)
            phone_elem = listing.find('p', string=re.compile(r'\(\d{3}\) \d{3}-\d{4}'))
            if phone_elem:
                business['phone'] = phone_elem.get_text(strip=True)
            
            if business['name']:
                businesses.append(business)
        
        return businesses

    def _parse_google_listings(self, html_content: str) -> List[Dict]:
        """
        Extracts business information from Google search results.
        """
        soup = BeautifulSoup(html_content, 'html.parser')
        businesses = []
        
        # Find all business listings in Google's local results
        listings = soup.find_all('div', {'class': 'VkpGBb'})
        
        for listing in listings:
            business = {
                'name': None,
                'address': None,
                'phone': None,
                'website': None,
                'source': 'Google'
            }
            
            # Extract business name
            name_elem = listing.find('div', {'role': 'heading'})
            if name_elem:
                business['name'] = name_elem.get_text(strip=True)
            
            # Extract address
            address_elem = listing.find('div', string=re.compile(r'[0-9].*[A-Za-z].*'))
            if address_elem:
                business['address'] = address_elem.get_text(strip=True)
            
            # Extract phone number
            phone_elem = listing.find(string=re.compile(r'\(\d{3}\) \d{3}-\d{4}'))
            if phone_elem:
                business['phone'] = phone_elem.strip()
            
            if business['name']:
                businesses.append(business)
        
        return businesses

    def save_results(self, businesses: List[Dict], filename: str = "spirits_locations.json"):
        """
        Saves the scraped business information to a JSON file.
        """
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(businesses, f, indent=2, ensure_ascii=False)
        print(f"Results saved to {filename}")

def main():
    location = input("Enter location to search (city, state): ")
    scraper = SpiritsLocationScraper(headless=False)  # Set to False to see the browser
    businesses = scraper.scrape_location(location)
    scraper.save_results(businesses)
    
    print(f"\nFound {len(businesses)} businesses:")
    for business in businesses:
        print(f"\nName: {business['name']}")
        if business['address']:
            print(f"Address: {business['address']}")
        if business['phone']:
            print(f"Phone: {business['phone']}")
        if business['website']:
            print(f"Website: {business['website']}")
        print(f"Source: {business['source']}")

if __name__ == "__main__":
    main()