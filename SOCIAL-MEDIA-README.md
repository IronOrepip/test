# NOVA social media setup

Use this page as a quick status note or copy its checklist into an Asana task.

## Current setup

- Website: <https://novaporto.eu/>
- LinkedIn company page: <https://www.linkedin.com/company/novaporto/>
- The LinkedIn icon in the homepage footer links to the public company page. It opens in a new tab.
- The homepage Organization structured data lists LinkedIn in `sameAs`.
- The existing social-share image is `social-share.png` (1200 × 630). Open Graph and Twitter metadata point to it.
- Instagram, X/Twitter, and Alibaba footer pictograms are placeholders, not links. Do not link them until NOVA's official profile URLs are confirmed.

## Where to make updates

Edit `index.html`:

- Footer icons are in the `.nova-footer-socials` section. Wrap each confirmed icon SVG in an anchor with an accessible label.
- Organization identity metadata is in the JSON-LD `Organization` block in `<head>`. Add only verified official profile URLs to its `sameAs` array.
- Social preview metadata (`og:image` and `twitter:image`) is in `<head>`. Keep the image publicly accessible at the referenced URL.

For external social links, use this pattern and preserve the existing icon SVG:

```html
<a href="OFFICIAL_PROFILE_URL"
   aria-label="NOVA on PLATFORM"
   target="_blank"
   rel="noopener noreferrer">
  <!-- Existing platform SVG -->
</a>
```

## Asana-ready checklist

- [x] Add LinkedIn company page link to the homepage footer.
- [x] Add LinkedIn URL to the Organization `sameAs` metadata.
- [x] Add the NOVA social preview image to Open Graph and Twitter metadata.
- [ ] Confirm the live homepage footer link opens the correct public LinkedIn page.
- [ ] Provide the official Instagram, X/Twitter, or other profile URLs if NOVA uses those platforms.
- [ ] For each confirmed profile, link its existing icon in the footer and add its URL to `sameAs`.
- [ ] Publish the updated site and refresh social preview caches if old previews remain.

## Notes

The admin dashboard URL is for managing the LinkedIn page; use the public company-page URL in the website and metadata. Never put passwords, access tokens, or other credentials in this file or an Asana task.
