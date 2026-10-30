/*
	Fills the page from content.json.
	With ?preview in the URL it shows draft content sent by the admin page instead.
*/

(function($) {

	var preview = /[?&]preview\b/.test(window.location.search),
		overlay = 'assets/css/images/overlay.png',
		platforms = {
			github:    { icon: 'brands fa-github',      label: 'GitHub' },
			linkedin:  { icon: 'brands fa-linkedin-in', label: 'LinkedIn' },
			instagram: { icon: 'brands fa-instagram',   label: 'Instagram' },
			twitter:   { icon: 'brands fa-twitter',     label: 'X / Twitter' },
			youtube:   { icon: 'brands fa-youtube',     label: 'YouTube' },
			email:     { icon: 'solid fa-envelope',     label: 'Email' },
			resume:    { icon: 'solid fa-file-alt',     label: 'Resume' },
			website:   { icon: 'solid fa-globe',        label: 'Website' }
		},
		uploads = {},
		galleryReady = false;

	// Helpers.

		function esc(value) {
			return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
				return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
			});
		}

		// Blank lines start a new paragraph; single line breaks are kept.
		function paragraphs(text) {
			return String(text || '')
				.split(/\n\s*\n/)
				.map(function(p) { return p.trim(); })
				.filter(Boolean)
				.map(function(p) { return '<p>' + esc(p).replace(/\n/g, '<br />') + '</p>'; })
				.join('');
		}

		// Files picked in the admin page but not saved yet are previewed from memory.
		function asset(path) {
			return uploads[path] || path || '';
		}

		function href(link) {
			link = String(link || '').trim();

			if (/^javascript:/i.test(link))
				return '#';

			if (/^[^\s@\/:]+@[^\s@\/]+\.[^\s@\/]+$/.test(link))
				return 'mailto:' + link;

			// "linkedin.com/in/me" -> "https://linkedin.com/in/me", but leave "files/resume.pdf" alone.
			if (!/^[a-z][a-z0-9+.-]*:/i.test(link)
			&&	/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(link)
			&&	!/^[^\/]+\.(pdf|jpe?g|png|gif|webp|svg|html?|json|txt|docx?)$/i.test(link))
				return 'https://' + link;

			return asset(link);
		}

		function link(url, label, className) {
			var target = href(url),
				external = !/^(#|mailto:|tel:)/.test(target);

			return '<a href="' + esc(target) + '"'
				+ (className ? ' class="' + className + '"' : '')
				+ (external ? ' target="_blank" rel="noopener"' : '')
				+ '>' + label + '</a>';
		}

		function cssUrl(path) {
			return 'url("' + String(path).replace(/["\\\n\r]/g, function(ch) {
				return '\\' + ch.charCodeAt(0).toString(16) + ' ';
			}) + '")';
		}

	// Render.

		function render(c) {
			var header = c.header || {},
				about = c.about || {},
				projects = c.projects || {},
				contact = c.contact || {},
				details = [],
				background = header.background ? cssUrl(asset(header.background)) : 'none';

			document.title = header.name || 'Portfolio';

			// Header.
				$('#portfolio-theme').text(
					'#header { background-image: url("' + overlay + '"), ' + background + '; }' +
					'@media screen and (max-width: 980px) { #footer { background-image: url("' + overlay + '"), ' + background + '; } }'
				);

				$('#header > .inner').html(
					(header.avatar ? '<span class="image avatar"><img src="' + esc(asset(header.avatar)) + '" alt="" /></span>' : '') +
					'<h1><strong>' + esc(header.name) + '</strong>' + (header.tagline ? '<br /> ' + esc(header.tagline) : '') + '</h1>'
				);

			// About.
				$('#one').html(
					(about.heading ? '<header class="major"><h2>' + esc(about.heading) + '</h2></header>' : '') +
					paragraphs(about.text) +
					(about.buttonLabel && about.buttonLink
						? '<ul class="actions"><li>' + link(about.buttonLink, esc(about.buttonLabel), 'button') + '</li></ul>'
						: '')
				).toggle(!!(about.heading || about.text));

			// Projects.
				$('#two').html(
					(projects.heading ? '<h2>' + esc(projects.heading) + '</h2>' : '') +
					'<div class="row">' +
					(projects.items || []).map(function(item) {
						var image = esc(asset(item.image));

						return '<article class="col-6 col-12-xsmall work-item">' +
							(item.image ? '<a href="' + image + '" class="image fit thumb"><img src="' + image + '" alt="" /></a>' : '') +
							'<h3>' + esc(item.title) + '</h3>' +
							paragraphs(item.description) +
							(item.link ? '<p>' + link(item.link, esc(item.linkLabel || 'View project')) + '</p>' : '') +
							'</article>';
					}).join('') +
					'</div>'
				).toggle(!!(projects.items && projects.items.length));

			// Contact.
				if (contact.email)
					details.push(['solid fa-envelope', 'Email', '<a href="mailto:' + esc(contact.email) + '">' + esc(contact.email) + '</a>']);

				if (contact.phone)
					details.push(['solid fa-mobile-alt', 'Phone', '<a href="tel:' + esc(contact.phone.replace(/[^\d+]/g, '')) + '">' + esc(contact.phone) + '</a>']);

				if (contact.location)
					details.push(['solid fa-map-marker-alt', 'Location', esc(contact.location).replace(/\n/g, '<br />')]);

				$('#three').html(
					(contact.heading ? '<h2>' + esc(contact.heading) + '</h2>' : '') +
					paragraphs(contact.text) +
					(details.length
						? '<ul class="labeled-icons">' + details.map(function(d) {
							return '<li><h3 class="icon ' + d[0] + '"><span class="label">' + d[1] + '</span></h3>' + d[2] + '</li>';
						}).join('') + '</ul>'
						: '')
				).toggle(!!(contact.heading || contact.text || details.length));

			// Footer.
				$('#social').html((c.social || []).filter(function(s) { return s.url; }).map(function(s) {
					var p = platforms[s.platform] || platforms.website;
					return '<li>' + link(s.url, '<span class="label">' + p.label + '</span>', 'icon ' + p.icon) + '</li>';
				}).join(''));

				$('#copyright').html('&copy; ' + esc(header.name));

		}

	// Lightbox gallery.

		function initGallery() {

			if (galleryReady)
				return;

			galleryReady = true;

			$('#two').poptrox({
				caption: function($a) { return $a.next('h3').text(); },
				overlayColor: '#2c2c2c',
				overlayOpacity: 0.85,
				popupCloserText: '',
				popupLoaderText: '',
				selector: '.work-item a.image',
				usePopupCaption: true,
				usePopupDefaultStyling: false,
				usePopupEasyClose: false,
				usePopupNav: true,
				windowMargin: (breakpoints.active('<=small') ? 0 : 50)
			});

		}

	// Load.

		if (preview) {

			window.addEventListener('message', function(event) {

				if (event.origin !== window.location.origin
				||	!event.data
				||	event.data.type !== 'portfolio:preview')
					return;

				uploads = event.data.uploads || {};
				render(event.data.content);

			});

			// Links would navigate the preview away from the page being edited.
				$(document).on('click', 'a', function(event) {
					event.preventDefault();
				});

			window.parent.postMessage({ type: 'portfolio:ready' }, window.location.origin);

		}
		else {

			fetch('content.json', { cache: 'no-cache' })
				.then(function(response) {
					if (!response.ok)
						throw new Error(response.status);

					return response.json();
				})
				.then(function(content) {
					render(content);
					initGallery();
				})
				.catch(function() {
					$('#one').html('<p>The page content could not be loaded. If you opened this file straight from your computer, open it through a web server instead (it works on GitHub Pages).</p>');
				});

		}

})(jQuery);
