/** Simple text content */
export const SIMPLE_TEXT = `
<html><body>
	<h1 id="title">Welcome to TestPage</h1>
	<p id="content">This is a simple paragraph with plain text content.</p>
</body></html>`;

/** Table with structured data */
export const TABLE = `
<html><body>
	<table id="data-table">
		<thead><tr><th>Name</th><th>Age</th><th>City</th></tr></thead>
		<tbody>
			<tr class="row"><td class="name">Alice</td><td class="age">30</td><td class="city">London</td></tr>
			<tr class="row"><td class="name">Bob</td><td class="age">25</td><td class="city">Paris</td></tr>
			<tr class="row"><td class="name">Carol</td><td class="age">35</td><td class="city">Berlin</td></tr>
		</tbody>
	</table>
</body></html>`;

/** Nested list structure */
export const NESTED_LIST = `
<html><body>
	<ul id="categories">
		<li class="category">Fruits
			<ul>
				<li class="item">Apple</li>
				<li class="item">Banana</li>
			</ul>
		</li>
		<li class="category">Vegetables
			<ul>
				<li class="item">Carrot</li>
				<li class="item">Potato</li>
			</ul>
		</li>
	</ul>
</body></html>`;

/** Form with multiple input types */
export const FORM = `
<html><body>
	<form id="test-form">
		<input id="name" name="name" type="text" />
		<input id="email" name="email" type="email" />
		<select id="role" name="role">
			<option value="">Select role</option>
			<option value="admin">Admin</option>
			<option value="user">User</option>
		</select>
		<textarea id="bio" name="bio"></textarea>
		<input id="terms" name="terms" type="checkbox" />
		<button id="submit" type="button" onclick="
			var result = {
				name: document.getElementById('name').value,
				email: document.getElementById('email').value,
				role: document.getElementById('role').value,
				bio: document.getElementById('bio').value,
				terms: document.getElementById('terms').checked
			};
			document.getElementById('output').textContent = JSON.stringify(result);
		">Submit</button>
	</form>
	<div id="output"></div>
</body></html>`;

/** Dynamic SPA-like content */
export const DYNAMIC_SPA = `
<html><body>
	<div id="app">
		<div id="loading">Loading...</div>
	</div>
	<script>
		setTimeout(() => {
			document.getElementById('loading').style.display = 'none';
			var content = document.createElement('div');
			content.id = 'spa-content';
			content.innerHTML = '<h2>Dashboard</h2><p class="metric">Revenue: $42,000</p><p class="metric">Users: 1,234</p>';
			document.getElementById('app').appendChild(content);
		}, 300);
	</script>
</body></html>`;

/** ARIA-labeled elements */
export const ARIA_LABELED = `
<html><body>
	<nav aria-label="Main navigation">
		<button aria-label="Open menu" id="menu-btn">☰</button>
		<a role="link" aria-label="Home" href="#">Home</a>
		<a role="link" aria-label="About" href="#">About</a>
	</nav>
	<main aria-label="Page content">
		<section aria-labelledby="section-title">
			<h2 id="section-title">Featured Article</h2>
			<p id="article-body">ARIA semantics improve accessibility.</p>
		</section>
	</main>
</body></html>`;

/** Hidden/visible toggle */
export const HIDDEN_TOGGLE = `
<html><body>
	<button id="toggle-btn" onclick="
		var el = document.getElementById('secret');
		el.style.display = el.style.display === 'none' ? 'block' : 'none';
	">Toggle</button>
	<div id="secret" style="display: none;">
		<p id="secret-text">This was hidden but now visible!</p>
	</div>
</body></html>`;

/** Multi-column layout */
export const MULTI_COLUMN = `
<html><body>
	<div class="grid" style="display: grid; grid-template-columns: 1fr 1fr 1fr;">
		<div class="column" id="col-1"><h3>Column A</h3><p class="col-text">Alpha content</p></div>
		<div class="column" id="col-2"><h3>Column B</h3><p class="col-text">Beta content</p></div>
		<div class="column" id="col-3"><h3>Column C</h3><p class="col-text">Gamma content</p></div>
	</div>
</body></html>`;

/** Definition list */
export const DEFINITION_LIST = `
<html><body>
	<dl id="glossary">
		<dt class="term">API</dt>
		<dd class="def">Application Programming Interface</dd>
		<dt class="term">DOM</dt>
		<dd class="def">Document Object Model</dd>
		<dt class="term">CSS</dt>
		<dd class="def">Cascading Style Sheets</dd>
	</dl>
</body></html>`;

/** Card grid layout */
export const CARD_GRID = `
<html><body>
	<div id="cards">
		<div class="card" data-id="1"><h3 class="card-title">Product A</h3><span class="card-price">$10</span></div>
		<div class="card" data-id="2"><h3 class="card-title">Product B</h3><span class="card-price">$20</span></div>
		<div class="card" data-id="3"><h3 class="card-title">Product C</h3><span class="card-price">$30</span></div>
		<div class="card" data-id="4"><h3 class="card-title">Product D</h3><span class="card-price">$40</span></div>
	</div>
</body></html>`;

// --- Cookie / popup banner fixtures ---

/** Cookie accept button matching: [class*="cookie"] button[class*="accept"] */
export const POPUP_COOKIE_ACCEPT = `
<html><body>
	<div class="cookie-notice" id="cookie-banner">
		<p>We use cookies</p>
		<button class="accept-btn" onclick="this.parentElement.style.display='none'">Accept All</button>
	</div>
	<div id="main-content"><p>Page content here</p></div>
</body></html>`;

/** GDPR modal matching: [class*="gdpr"] button[class*="accept"] */
export const POPUP_GDPR_MODAL = `
<html><body>
	<div class="gdpr-overlay" id="gdpr-banner" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;">
		<div class="gdpr-dialog">
			<p>GDPR consent required</p>
			<button class="accept-gdpr" onclick="document.getElementById('gdpr-banner').style.display='none'">I Accept</button>
		</div>
	</div>
	<div id="main-content"><p>Page content under overlay</p></div>
</body></html>`;

/** Overlay close matching: [class*="overlay"] [class*="close"] */
export const POPUP_OVERLAY_CLOSE = `
<html><body>
	<div class="promo-overlay" id="overlay-banner" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;">
		<div class="promo-dialog">
			<span class="close-icon" style="cursor:pointer;" onclick="document.getElementById('overlay-banner').style.display='none'">✕</span>
			<p>Special offer!</p>
		</div>
	</div>
	<div id="main-content"><p>Page content here</p></div>
</body></html>`;

/** Banner dismiss matching: [class*="banner"] [class*="dismiss"] */
export const POPUP_BANNER_DISMISS = `
<html><body>
	<div class="notification-banner" id="notif-banner">
		<p>Important announcement</p>
		<button class="dismiss-action" onclick="document.getElementById('notif-banner').style.display='none'">Dismiss</button>
	</div>
	<div id="main-content"><p>Page content here</p></div>
</body></html>`;

/** Browser dialog (alert/confirm) — handled by the dialog event listener */
export const POPUP_BROWSER_DIALOG = `
<html><body>
	<div id="main-content"><p>Page with dialog</p></div>
	<script>
		setTimeout(() => {
			window.__dialogFired = true;
			confirm('Do you accept cookies?');
		}, 200);
	</script>
</body></html>`;

/** Delayed button for retry testing */
export const DELAYED_BUTTON = `
<html><body>
	<div id="container">
		<p>Waiting for button...</p>
	</div>
	<div id="result"></div>
	<script>
		setTimeout(() => {
			var btn = document.createElement('button');
			btn.id = 'late-btn';
			btn.textContent = 'Click me';
			btn.onclick = () => document.getElementById('result').textContent = 'button-clicked';
			document.getElementById('container').appendChild(btn);
		}, 1500);
	</script>
</body></html>`;
