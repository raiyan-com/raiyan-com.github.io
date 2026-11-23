/*
	Fills the page from content.json.
	The home page lists the projects; index.html?p=<project> shows one project on its own.
	With ?preview in the URL it shows draft content sent by the admin page instead.
*/

(function($) {

	var params = new URLSearchParams(window.location.search),
		preview = params.has('preview'),
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches,
		coverObserver = null,
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

		function videoEmbed(src, looping, style, loopSrc, poster) {
			var m;

			if ((m = src.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i)))
				return embed('https://www.youtube-nocookie.com/embed/' + m[1]);

			if ((m = src.match(/vimeo\.com\/(?:video\/)?(\d+)/i)))
				return embed('https://player.vimeo.com/video/' + m[1]);

			if ((m = src.match(/drive\.google\.com\/file\/d\/([\w-]+)/i)))
				return embed('https://drive.google.com/file/d/' + m[1] + '/preview');

			style = (poster ? ' poster="' + esc(asset(poster)) + '"' : '') + (style ? ' style="' + style + '"' : '');

			if (looping && !calm)
				return '<video data-src="' + esc(href(loopSrc || src)) + '" muted loop playsinline' + style + '></video>';

			return '<video src="' + esc(href(src)) + '" controls playsinline preload="metadata"' + style + '></video>';
		}

		function embed(url) {
			return '<div class="embed"><iframe src="' + esc(url) + '" title="Video" loading="lazy" '
				+ 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
				+ 'allowfullscreen></iframe></div>';
		}

		function mediaItem(m, grid) {
			var label = esc(m.caption),
				caption = m.caption ? '<p class="caption">' + (grid ? '<strong>' + label + '</strong>' : label) + '</p>' : '',
				level = parseFloat(m.brightness),
				dim = level > 0 ? 'filter: brightness(' + (level / 100) + ');' : '',
				player, src;

			if (!m.src)
				return '';

			if (m.type === 'video') {
				player = videoEmbed(m.src, grid, dim, m.preview, m.poster);

				if (grid && !calm && /^<video/.test(player))
					player = '<a href="' + esc(href(m.src)) + '" class="image fit thumb video-link" data-dim="' + dim + '">' + player + '</a>';

				return '<div class="' + (grid ? 'col-6 col-12-xsmall' : 'col-12') + ' media media-video">' + player + caption + '</div>';
			}

			src = esc(asset(m.src));

			return '<div class="' + (grid ? 'col-6 col-12-xsmall' : 'col-4 col-6-small') + ' media media-photo">'
				+ '<a href="' + src + '" class="image fit thumb"><img src="' + src + '" alt="' + esc(m.caption) + '" loading="lazy" /></a>'
				+ caption + '</div>';
		}

		// Shape of a photo or video as width / height, from "9:16", "720x1280" or a number; 0 when unknown.
		function ratio(value) {
			var m = String(value || '').match(/^\s*([\d.]+)\s*[:x\/]\s*([\d.]+)\s*$/i),
				r = m ? parseFloat(m[1]) / parseFloat(m[2]) : parseFloat(value);

			return r > 0.1 && r < 10 ? r : 0;
		}

		// One photo or video in a flowing gallery: each keeps its own shape, so nothing is cropped.
		function flowItem(m) {
			var level = parseFloat(m.brightness),
				dim = level > 0 ? 'filter: brightness(' + (level / 100) + ');' : '',
				caption = m.caption ? '<p class="caption">' + esc(m.caption) + '</p>' : '',
				src, player;

			if (!m.src)
				return '';

			if (m.type === 'video') {
				player = videoEmbed(m.src, true, dim, m.preview, m.poster);

				if (!calm && /^<video/.test(player))
					player = '<a href="' + esc(href(m.src)) + '" class="image thumb video-link" data-dim="' + dim + '">' + player + '</a>';

				return '<div class="flow-item media media-video" data-ratio="' + (ratio(m.ratio) || (/^<div/.test(player) ? 16 / 9 : 0)) + '">' + player + caption + '</div>';
			}

			src = esc(asset(m.src));

			return '<div class="flow-item media media-photo" data-ratio="' + ratio(m.ratio) + '">'
				+ '<a href="' + src + '" class="image thumb"><img src="' + src + '" alt="' + esc(m.caption) + '" loading="lazy" /></a>'
				+ caption + '</div>';
		}

		// Lays flowing galleries out in rows that fill the width, every item in a row the same height.
		function layoutFlow() {
			$('#project .flow').each(function() {
				var box = this,
					width = box.clientWidth,
					gap = parseFloat(getComputedStyle(box).columnGap) || 0,
					target = width < 600 ? 230 : 340,
					rows = [],
					row = [],
					last;

				function shape(el) {
					return parseFloat(el.getAttribute('data-ratio')) || 16 / 9;
				}

				function height(items) {
					var total = items.reduce(function(sum, el) { return sum + shape(el); }, 0);

					return (width - gap * (items.length - 1)) / total;
				}

				// The picture gets the row's height; a caption, if any, sits underneath it.
				function place(items, h) {
					items.forEach(function(el) {
						el.style.width = Math.floor(shape(el) * h) + 'px';
						el.firstElementChild.style.height = Math.floor(h) + 'px';
					});
				}

				$(box).children('.flow-item').each(function() {
					var before = row.length ? height(row) : Infinity,
						after;

					row.push(this);
					after = height(row);

					if (after > target)
						return;

					// Close the row where its height lands nearest the target.
					if (row.length > 1 && before <= target * 1.35 && Math.abs(before - target) < Math.abs(after - target)) {
						row.pop();
						rows.push(row);
						row = [this];

						if (height(row) <= target) {
							rows.push(row);
							row = [];
						}

						return;
					}

					rows.push(row);
					row = [];
				});

				// A short last row joins the row above when that still leaves the items a good size (never under 180px tall).
				if (row.length && rows.length && height(rows[rows.length - 1].concat(row)) >= Math.max(target * 0.6, 180)) {
					rows[rows.length - 1] = rows[rows.length - 1].concat(row);
					row = [];
				}

				rows.forEach(function(items) {
					place(items, height(items));
				});

				// A last row stays near the usual size; when it is the only row, it may grow to fill the width.
				if (row.length)
					place(row, Math.min(rows.length ? target : target * 1.5, height(row)));
			});
		}

		// Items without a saved shape take it from the file once it loads.
		function learnShapes() {
			$('#project .flow-item[data-ratio="0"]').each(function() {
				var item = this,
					media = $(item).find('img, video')[0];

				function learn() {
					var w = media.naturalWidth || media.videoWidth,
						h = media.naturalHeight || media.videoHeight;

					if (w && h) {
						item.setAttribute('data-ratio', w / h);
						layoutFlow();
					}
				}

				if (!media)
					return;

				if ((media.naturalWidth || media.videoWidth))
					learn();
				else
					$(media).one('load loadedmetadata', learn);
			});
		}

		// A cover video plays on a loop on the card, with the cover image showing until it loads.
		function cardMedia(item) {
			if (item.coverVideo && !calm)
				return '<video data-src="' + esc(href(item.coverVideo)) + '"' + (item.image ? ' poster="' + esc(asset(item.image)) + '"' : '')
					+ ' muted loop playsinline aria-label="' + esc(item.title) + '"></video>';

			return item.image ? '<img src="' + esc(asset(item.image)) + '" alt="' + esc(item.title) + '" loading="lazy" />' : '';
		}

		// Looping videos load as they come near the screen and pause when they leave it.
		function watchLoopingVideos() {
			if (coverObserver)
				coverObserver.disconnect();

			coverObserver = new IntersectionObserver(function(entries) {
				entries.forEach(function(entry) {
					var video = entry.target;

					if (!entry.isIntersecting) {
						video.removeAttribute('data-near');
						video.pause();
						return;
					}

					video.setAttribute('data-near', '');

					if (!video.getAttribute('src'))
						video.src = video.getAttribute('data-src');

					video.play().catch(function() {});
				});
			}, { rootMargin: '50px 0px' });

			$('#main video[data-src]').each(function() {
				coverObserver.observe(this);
			});
		}

		function certItem(item) {
			var src = esc(asset(item.image)),
				caption = esc(item.title) + (item.date ? ' (' + esc(item.date) + ')' : '');

			return '<div class="media media-photo">'
				+ (item.image ? '<a href="' + src + '" class="image fit thumb"><img src="' + src + '" alt="' + esc(item.title) + '" loading="lazy" /></a>' : '')
				+ '<p class="caption">' + caption + '</p></div>';
		}

	// Render.

		function render() {
			var c = content,
				header = c.header || {},
				items = (c.projects && c.projects.items) || [],
				slugs = projectSlugs(items),
				background = header.background ? cssUrl(asset(header.background)) : 'none',
				layers = 'url("' + overlay + '"), linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), ' + background,
				index;

			// Header.
				$('#portfolio-theme').text(
					'#header { background-image: ' + layers + '; }' +
					'@media screen and (max-width: 980px) { #footer { background-image: ' + layers + '; } }'
				);

				$('#header > .inner').html(
					(header.avatar ? '<span class="image avatar"><img src="' + esc(asset(header.avatar)) + '" alt="' + esc(header.name) + '" /></span>' : '') +
					'<h1><strong>' + esc(header.name) + '</strong>' + (header.tagline ? '<span class="tagline">' + esc(header.tagline) + '</span>' : '') + '</h1>'
				);

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
				resume = c.resume || {},
				groups = resume.groups || [],
				certs = c.certifications || {},
				certItems = certs.items || [],
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
							(item.image || item.coverVideo ? '<a' + to + ' class="image fit thumb">' + cardMedia(item) + '</a>' : '') +
							'<h3>' + esc(item.title) + '</h3>' +
							paragraphs(item.description) +
							'<ul class="actions"><li><a' + to + ' class="button small">View project</a></li></ul>' +
							'</article>';
					}).join('') +
					'</div>'
				).toggle(items.length > 0);

				watchLoopingVideos();

			// Education, leadership and so on.
				$('#resume').html(
					(resume.heading ? '<h2>' + esc(resume.heading) + '</h2>' : '') +
					groups.map(function(group) {
						return '<div class="resume-group">' +
							(group.heading ? '<h3>' + esc(group.heading) + '</h3>' : '') +
							(group.items || []).map(function(item) {
								return '<div class="resume-item">' +
									'<div class="resume-title"><strong>' + esc(item.title) + '</strong>' +
									(item.date ? '<span class="date">' + esc(item.date) + '</span>' : '') +
									'</div>' +
									paragraphs(item.text) +
									'</div>';
							}).join('') +
							'</div>';
					}).join('')
				).toggle(groups.length > 0);

			// Certifications.
				$('#certifications').html(
					(certs.heading ? '<h2>' + esc(certs.heading) + '</h2>' : '') +
					'<div class="cert-row">' + certItems.map(certItem).join('') + '</div>'
				).toggle(certItems.length > 0);

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

		function showcaseBlock(title, className, media) {
			if (!media.length)
				return '';

			return '<div class="showcase-block"><h3>' + title + '</h3><div class="gallery grid ' + className + ' count-' + media.length + '">'
				+ media.map(function(m) { return mediaItem(m, true); }).join('')
				+ '</div></div>';
		}

		// Leads with what you did: **double stars** in the write-up mark the words to stand out.
		function renderShowcase(item) {
			var media = item.media || [],
				videos = media.filter(function(m) { return m.type === 'video'; }),
				photos = media.filter(function(m) { return m.type !== 'video'; }),
				stats = (item.stats || []).filter(function(s) { return s.value; }),
				// A single extra video sits under the main one at full width, not alone in a row of tall boxes.
				stacked = videos.length === 2;

			return '<div class="showcase-intro' + (stats.length ? '' : ' single') + '"><div class="showcase-role"><h3>What I did</h3>'
				+ paragraphs(item.details || item.description).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
				+ '</div>'
				+ (stats.length
					? '<ul class="showcase-stats">' + stats.map(function(s) {
						return '<li><strong>' + esc(s.value) + '</strong><span>' + esc(s.label) + '</span></li>';
					}).join('') + '</ul>'
					: '')
				+ '</div>'
				+ projectButtons(item)
				+ showcaseBlock('In action', 'main', stacked ? videos : videos.slice(0, 1))
				+ showcaseBlock('Behind the scenes', 'tall', stacked ? [] : videos.slice(1))
				+ showcaseBlock(photos.length > 1 ? 'Photos' : 'The event', photos.length > 1 ? 'photo-grid' : 'photos', photos);
		}

		// The project's link plus any extra buttons, such as slides or a demo.
		function projectButtons(item) {
			var buttons = (item.link ? [{ url: item.link, label: item.linkLabel || 'Visit project' }] : [])
				.concat((item.links || []).filter(function(b) { return b.url; }));

			if (!buttons.length)
				return '';

			return '<ul class="actions">' + buttons.map(function(b, i) {
				return '<li>' + link(b.url, esc(b.label || 'Open'), i ? 'button' : 'button primary') + '</li>';
			}).join('') + '</ul>';
		}

		function renderProject(c, items, slugs, index) {
			var header = c.header || {},
				item = items[index],
				next = items.length > 1 ? (index + 1) % items.length : -1,
				grid = !!item && (item.layout === 'grid' || item.layout === 'text-grid'),
				showText = !item || item.layout !== 'grid',
				showcase = !!item && item.layout === 'showcase',
				flow = !!item && (item.layout === 'flow' || item.layout === 'rows'),
				back = '<a href="./" class="back" data-home>&larr; All projects</a>';

			$('#one, #two, #resume, #certifications, #three').hide();

			if (!item) {
				document.title = 'Project not found | ' + (header.name || 'Portfolio');
				$('#project').html(back + '<h2>Project not found</h2><p>This project may have been renamed or removed.</p>').show();
				return;
			}

			document.title = (item.title || 'Project') + ' | ' + (header.name || 'Portfolio');

			$('#project').html(
				back +
				'<header class="major">' + (item.eyebrow ? '<p class="eyebrow">' + esc(item.eyebrow) + '</p>' : '') + '<h2>' + esc(item.title) + '</h2></header>' +
				(item.image && showText && !flow ? '<span class="image fit cover' + (showcase ? ' banner' : '') + '"><img src="' + esc(asset(item.image)) + '" alt="" /></span>' : '') +
				// In a flowing page the cover opens full size, so a diagram can be read.
				(item.image && item.layout === 'flow' ? '<div class="media media-photo flow-cover"><a href="' + esc(asset(item.image)) + '" class="image fit cover"><img src="' + esc(asset(item.image)) + '" alt="" /></a><p class="caption">' + esc(item.title) + '</p></div>' : '') +
				(showText && !showcase ? '<div class="project-text">' + paragraphs(item.details || item.description).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</div>' : '') +
				(showcase ? '' : projectButtons(item)) +
				(showcase ? renderShowcase(item) : '') +
				(flow && (item.media || []).length ? '<div class="flow">' + item.media.map(flowItem).join('') + '</div>' : '') +
				(!showcase && !flow && (item.media || []).length
					? '<div class="gallery' + (grid ? ' grid' : '') + '"><div class="row ' + (grid ? '' : 'gtr-50 ') + 'gtr-uniform">'
						+ item.media.map(function(m) { return mediaItem(m, grid); }).join('')
						+ '</div></div>'
					: '') +
				'<ul class="actions pager">' +
					'<li><a href="./" class="button" data-home>&larr; All projects</a></li>' +
					(next >= 0 ? '<li><a' + projectLink(slugs, next) + ' class="button">Next: ' + esc(items[next].title) + ' &rarr;</a></li>' : '') +
				'</ul>'
			).show();

			// A phone-shaped or square video shows at full height in the middle instead of in a wide black box.
			$('#project .gallery:not(.grid) video').each(function() {
				var video = this;

				function fit() {
					$(video).toggleClass('tall', video.videoHeight >= video.videoWidth);
				}

				if (video.readyState >= 1)
					fit();
				else
					$(video).one('loadedmetadata', fit);
			});

			layoutFlow();
			learnShapes();
			watchLoopingVideos();
		}

	// Lightbox for project and certificate photos.

		function initGallery() {
			$('#main').poptrox({
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

	// Videos open in a pop-up styled like the photo one, which can't play video files itself.

		function openVideo($link) {
			var $popup = $('<div class="video-popup poptrox-overlay"><div class="poptrox-popup">'
					+ '<video controls autoplay loop playsinline></video>'
					+ '<span class="caption"></span><span class="closer"></span></div></div>'),
				video = $popup.find('video')[0];

			function close() {
				$(document).off('keydown.videoPopup');
				video.pause();
				video.removeAttribute('src');
				video.load();
				$popup.remove();
			}

			video.src = $link.attr('href');
			video.style.cssText = $link.attr('data-dim');
			$popup.find('.caption').text($link.next('.caption').text());

			$popup.on('click', close);
			$popup.find('.poptrox-popup').on('click', function(event) {
				if (!$(event.target).is('.closer'))
					event.stopPropagation();
			});

			$(document).on('keydown.videoPopup', function(event) {
				if (event.key === 'Escape')
					close();
			});

			$('body').append($popup);
		}

	// Load.

		// Flowing galleries re-fit their rows when the window changes size.
		(function() {
			var timer;

			window.addEventListener('resize', function() {
				clearTimeout(timer);
				timer = setTimeout(layoutFlow, 100);
			});
		})();

		// Browsers pause silent videos in hidden tabs, so start them again on the way back.
		document.addEventListener('visibilitychange', function() {
			if (!document.hidden)
				$('#main video[data-near]').each(function() {
					this.play().catch(function() {});
				});
		});

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

			$(document).on('click', 'a.video-link', function(event) {
				event.preventDefault();
				openVideo($(this));
			});

			fetch('content.json', { cache: 'no-cache' })
				.then(function(response) {
					if (!response.ok)
						throw new Error(response.status);

					return response.json();
				})
				.then(function(data) {
					content = data;
					render();
					initGallery();
					$(document).trigger('portfolio:rendered');
				})
				.catch(function() {
					$('#one').html('<p>The page content could not be loaded. If you opened this file straight from your computer, open it through a web server instead (it works on GitHub Pages).</p>');
				});

		}

})(jQuery);
