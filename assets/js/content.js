/*
	Fills the page from content.json.
	The home page lists the projects; index.html?p=<project> shows one project on its own.
	With ?preview in the URL it shows draft content sent by the admin page instead.
*/

(function($) {

	var params = new URLSearchParams(window.location.search),
		preview = params.has('preview'),
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
		content = {},
		uploads = {},
		previewProject = null;

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
			&&	!/^[^\/]+\.(pdf|jpe?g|png|gif|webp|svg|html?|json|txt|docx?|mp4|webm|mov)$/i.test(link))
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

		// Address name for each project, from its title ("Exo Skeleton" -> "exo-skeleton").
		function projectSlugs(items) {
			var used = {};

			return items.map(function(item) {
				var base = String(item.title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
						.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project',
					name = base,
					n = 2;

				while (used[name])
					name = base + '-' + n++;

				used[name] = true;
				return name;
			});
		}

		// Links to a project or back home. The admin preview follows them without leaving the page.
		function projectLink(slugs, index) {
			return ' href="?p=' + encodeURIComponent(slugs[index]) + '" data-project="' + index + '"';
		}

		function videoEmbed(src) {
			var m;

			if ((m = src.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i)))
				return embed('https://www.youtube-nocookie.com/embed/' + m[1]);

			if ((m = src.match(/vimeo\.com\/(?:video\/)?(\d+)/i)))
				return embed('https://player.vimeo.com/video/' + m[1]);

			if ((m = src.match(/drive\.google\.com\/file\/d\/([\w-]+)/i)))
				return embed('https://drive.google.com/file/d/' + m[1] + '/preview');

			return '<video src="' + esc(href(src)) + '" controls playsinline preload="metadata"></video>';
		}

		function embed(url) {
			return '<div class="embed"><iframe src="' + esc(url) + '" title="Video" loading="lazy" '
				+ 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
				+ 'allowfullscreen></iframe></div>';
		}

		function mediaItem(m) {
			var caption = m.caption ? '<p class="caption">' + esc(m.caption) + '</p>' : '',
				src;

			if (!m.src)
				return '';

			if (m.type === 'video')
				return '<div class="col-12 media media-video">' + videoEmbed(m.src) + caption + '</div>';

			src = esc(asset(m.src));

			return '<div class="col-4 col-6-small media media-photo">'
				+ '<a href="' + src + '" class="image fit thumb"><img src="' + src + '" alt="' + esc(m.caption) + '" loading="lazy" /></a>'
				+ caption + '</div>';
		}

	// Render.

		function render() {
			var c = content,
				header = c.header || {},
				items = (c.projects && c.projects.items) || [],
				slugs = projectSlugs(items),
				background = header.background ? cssUrl(asset(header.background)) : 'none',
				index;

			// Header.
				$('#portfolio-theme').text(
					'#header { background-image: url("' + overlay + '"), ' + background + '; }' +
					'@media screen and (max-width: 980px) { #footer { background-image: url("' + overlay + '"), ' + background + '; } }'
				);

				$('#header > .inner').html(
					(header.avatar ? '<span class="image avatar"><img src="' + esc(asset(header.avatar)) + '" alt="' + esc(header.name) + '" /></span>' : '') +
					'<h1><strong>' + esc(header.name) + '</strong>' + (header.tagline ? '<span class="tagline">' + esc(header.tagline) + '</span>' : '') + '</h1>'
				);

				$('#favicon').attr('href', header.avatar ? asset(header.avatar) : 'images/avatar.jpg');

			// Footer.
				$('#social').html((c.social || []).filter(function(s) { return s.url; }).map(function(s) {
					var p = platforms[s.platform] || platforms.website;
					return '<li>' + link(s.url, '<span class="label">' + p.label + '</span>', 'icon ' + p.icon) + '</li>';
				}).join(''));

				$('#copyright').html('&copy; ' + esc(header.name));

			// Main.
				if (preview)
					index = previewProject != null && previewProject < items.length ? previewProject : null;
				else
					index = params.has('p') ? slugs.indexOf(params.get('p')) : null;

				if (index == null)
					renderHome(c, items, slugs);
				else
					renderProject(c, items, slugs, index);

				$('#main > section').removeClass('is-first')
					.filter(function() { return $(this).css('display') !== 'none'; })
					.first().addClass('is-first');

		}

		function renderHome(c, items, slugs) {
			var header = c.header || {},
				about = c.about || {},
				projects = c.projects || {},
				contact = c.contact || {},
				details = [];

			document.title = header.name || 'Portfolio';
			$('#project').hide().empty();

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
					items.map(function(item, i) {
						var to = projectLink(slugs, i);

						return '<article class="col-6 col-12-xsmall work-item">' +
							(item.image ? '<a' + to + ' class="image fit thumb"><img src="' + esc(asset(item.image)) + '" alt="' + esc(item.title) + '" loading="lazy" /></a>' : '') +
							'<h3>' + esc(item.title) + '</h3>' +
							paragraphs(item.description) +
							'<ul class="actions"><li><a' + to + ' class="button small">View project</a></li></ul>' +
							'</article>';
					}).join('') +
					'</div>'
				).toggle(items.length > 0);

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

		}

		function renderProject(c, items, slugs, index) {
			var header = c.header || {},
				item = items[index],
				next = items.length > 1 ? (index + 1) % items.length : -1,
				back = '<a href="./" class="back" data-home>&larr; All projects</a>';

			$('#one, #two, #three').hide();

			if (!item) {
				document.title = 'Project not found · ' + (header.name || 'Portfolio');
				$('#project').html(back + '<h2>Project not found</h2><p>This project may have been renamed or removed.</p>').show();
				return;
			}

			document.title = (item.title || 'Project') + ' · ' + (header.name || 'Portfolio');

			$('#project').html(
				back +
				'<header class="major"><h2>' + esc(item.title) + '</h2></header>' +
				(item.image ? '<span class="image fit cover"><img src="' + esc(asset(item.image)) + '" alt="" /></span>' : '') +
				paragraphs(item.details || item.description) +
				(item.link ? '<ul class="actions"><li>' + link(item.link, esc(item.linkLabel || 'Visit project'), 'button primary') + '</li></ul>' : '') +
				((item.media || []).length ? '<div class="gallery"><div class="row gtr-50 gtr-uniform">' + item.media.map(mediaItem).join('') + '</div></div>' : '') +
				'<ul class="actions pager">' +
					'<li><a href="./" class="button" data-home>&larr; All projects</a></li>' +
					(next >= 0 ? '<li><a' + projectLink(slugs, next) + ' class="button">Next: ' + esc(items[next].title) + ' &rarr;</a></li>' : '') +
				'</ul>'
			).show();
		}

	// Lightbox for a project's photos.

		function initGallery() {
			$('#project').poptrox({
				caption: function($a) { return $a.next('.caption').text(); },
				overlayColor: '#2c2c2c',
				overlayOpacity: 0.85,
				popupCloserText: '',
				popupLoaderText: '',
				selector: '.media-photo a.image',
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
				var moved;

				if (event.origin !== window.location.origin
				||	!event.data
				||	event.data.type !== 'portfolio:preview')
					return;

				content = event.data.content || {};
				uploads = event.data.uploads || {};

				if ('project' in event.data) {
					moved = previewProject !== event.data.project;
					previewProject = event.data.project;
				}

				render();

				if (moved)
					window.scrollTo(0, 0);
			});

			// Project and back links switch the preview; other links would leave the page being edited.
				$(document).on('click', 'a', function(event) {
					var $a = $(this);

					event.preventDefault();

					if (!$a.is('[data-project], [data-home]'))
						return;

					previewProject = $a.is('[data-project]') ? parseInt($a.attr('data-project'), 10) : null;
					render();
					window.scrollTo(0, 0);
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
				.then(function(data) {
					content = data;
					render();

					if (params.has('p'))
						initGallery();
				})
				.catch(function() {
					$('#one').html('<p>The page content could not be loaded. If you opened this file straight from your computer, open it through a web server instead (it works on GitHub Pages).</p>');
				});

		}

})(jQuery);
