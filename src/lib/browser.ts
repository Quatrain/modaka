import { launch } from 'puppeteer-core';
import { Log } from '@quatrain/log';
import * as fs from 'node:fs/promises';

export async function fetchHtmlWithJs(url: string): Promise<string> {
   let executablePath = process.env.CHROME_PATH || '';

   if (!executablePath) {
      if (process.platform === 'darwin') {
         executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      } else {
         executablePath = '/usr/bin/chromium-browser';
      }
   }

   // Verify executable existence to throw a helpful error
   try {
      await fs.access(executablePath);
   } catch {
      throw new Error(
         `L'exécutable Chrome/Chromium est introuvable au chemin : "${executablePath}". ` +
         `Veuillez configurer la variable CHROME_PATH dans votre fichier .env.`
      );
   }

   Log.info(`[Browser Scraper] Launching Chrome at: ${executablePath} to crawl: ${url}`);

   const browser = await launch({
      executablePath,
      headless: true,
      args: [
         '--no-sandbox',
         '--disable-setuid-sandbox',
         '--disable-gpu',
         '--disable-dev-shm-usage',
         '--blink-settings=imagesEnabled=false'
      ]
   });

   try {
      const page = await browser.newPage();
      
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
         'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      Log.info(`[Browser Scraper] Navigating to ${url}...`);
      await page.goto(url, {
         waitUntil: ['domcontentloaded', 'networkidle2'],
         timeout: 30000
      });

      const html = await page.content();
      Log.info(`[Browser Scraper] Successfully extracted ${html.length} bytes of rendered HTML`);
      return html;
   } catch (err: any) {
      Log.error(`[Browser Scraper] Error crawling ${url}: ${err.message}`);
      throw err;
   } finally {
      await browser.close();
   }
}
