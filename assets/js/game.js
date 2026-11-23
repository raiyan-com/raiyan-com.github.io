/*
	Game mode. The switch at the top right turns the page dark and locks each section
	behind a star. Walk and jump along the slabs to collect the stars and open the sections.
*/

(function($) {

	// The admin preview shows the plain page.
		if (new URLSearchParams(window.location.search).has('preview'))
			return;

	var $window = $(window),
		$body = $('body'),
		touch = window.matchMedia('(hover: none)').matches,
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches,
		storageKey = 'portfolio-game',
		symbols = '#+×÷=≠~≈<>±≤≥^√◊∞∂∏∑∫¬ΔΩμπ$¢¥ƒ£€₹¤%⅓⅔¼½¾⅛⅜⅝⅞§¶©®℗™*†‡{}[]?!¿«»',
		scrambleTime = 1600,
		scrambleSpeed = 33,
		wordsPerFrame = 30,
		fadeTime = 500,
		controls = {
			ArrowLeft: 'left', KeyA: 'left',
			ArrowRight: 'right', KeyD: 'right',
			ArrowUp: 'jump', KeyW: 'jump', Space: 'jump'
		},

		// Positions of each pose in images/game/character.png.
		poses = { idle: 0, idleAlt: 1, blink: 2, walk: 3, jump: 5, fall: 6 },

		// Movement, in pixels and seconds.
		speed = 320,
		gravity = 2300,
		jumpSpeed = 830,
		maxFall = 1400,

		// A jump still counts this long after leaving a slab, or this long before landing.
		forgiveness = 0.12,

		floorGap = 56,       // space between a floor and the section under it
		floorHeight = 32,
		slabHeight = 26,
		starWidth = 42,
		starHeight = 38,

		player = { width: 42, height: 60, x: 0, y: 0, vy: 0, face: 1, grounded: false, coyote: 0, buffer: 0, clock: 0, pose: -1 },
		keys = { left: false, right: false },
		state = $.extend({ on: false, unlocked: 0 }, load()),
		sections = [],
		levels = [],
		slabs = [],
		bounds = { left: 0, right: 0 },
		ready = false,
		running = false,
		lastTime = 0,
		scrambled = [],
		decoding = [],
		watching = [],
		lastFlicker = 0,
		preloaded = [],
		mainSize = { width: 0, height: 0 },
		wordTemplate = $('<span class="game-word"><span class="game-real"></span><span class="game-symbols"></span></span>')[0],
		messageTimer,
		observer,
		$switch, $count, $message, $layer, $player, $squash, $sprite;

	// Saved for this visit only, so opening a project and coming back keeps your progress.

		function load() {
			try {
				return JSON.parse(window.sessionStorage.getItem(storageKey)) || {};
			}
			catch (e) {
				return {};
			}
		}

		function save() {
			try {
				window.sessionStorage.setItem(storageKey, JSON.stringify(state));
			}
			catch (e) {}
		}

	// Helpers.

		function clamp(value, low, high) {
			return Math.max(low, Math.min(high, value));
		}

		// The level the player is working on.
		function currentIndex() {
			return Math.min(state.unlocked, levels.length - 1);
		}

		function isOpen(index) {
			return index < state.unlocked && index < levels.length - 1;
		}

	// Switch, counter and touch buttons.

		function buildInterface() {
			$switch = $('<button type="button" id="game-switch" role="switch" aria-checked="false">' +
				'<span class="track"><span class="knob"></span></span><span class="text">Game mode</span></button>').appendTo($body);

			$switch.on('click', function() {
				setOn(!state.on);
				$switch.blur();
			});

			$('<div id="game-hud"><span class="count"><img src="images/game/star.png" alt="Stars" /><span></span></span><p class="message" aria-live="polite"></p></div>').appendTo($body);
			$count = $('#game-hud .count span');
			$message = $('#game-hud .message');

			$('<div id="game-pad"><div class="group">' +
				'<button type="button" data-action="left" aria-label="Move left"><span class="arrow left"></span></button>' +
				'<button type="button" data-action="right" aria-label="Move right"><span class="arrow right"></span></button>' +
				'</div><button type="button" data-action="jump">Jump</button></div>').appendTo($body)
				.on('pointerdown', 'button', function(event) {
					event.preventDefault();
					press($(this).data('action'), true);
				})
				.on('pointerup pointercancel pointerleave', 'button', function() {
					press($(this).data('action'), false);
				})
				.on('contextmenu', false);
		}

		function setOn(on) {
			state.on = on;

			if (!on)
				state.unlocked = 0;

			save();
			applyTheme();

			if (on) {
				start();
				showSpawn();
			}
			else
				stop();
		}

		function applyTheme() {
			$body.toggleClass('game-on', state.on);
			$switch.attr('aria-checked', String(state.on));
		}

		function press(action, down) {
			if (action !== 'jump')
				keys[action] = down;
			else if (down)
				player.buffer = forgiveness;
		}

		function onKey(event) {
			var action = controls[event.code];

			if (!action
			||	event.ctrlKey || event.metaKey || event.altKey
			||	$('.poptrox-overlay:visible').length)
				return;

			event.preventDefault();

			if (!event.repeat)
				press(action, event.type === 'keydown');
		}

	// Start and stop.

		function start() {
			if (!ready || running)
				return;

			sections = $('#main > section').filter(function() {
				return this.id !== 'project' && $(this).css('display') !== 'none';
			}).get();

			// Project pages only get the dark theme.
				if (!sections.length)
					return;

			state.unlocked = Math.min(state.unlocked, sections.length);
			$body.addClass('game-playing');
			applyLocks();
			sections.slice(state.unlocked).forEach(scramble);

			$layer = $('<div id="game-layer" aria-hidden="true"></div>').appendTo($body);
			$player = $('<div id="game-player"><div class="squash"><div class="sprite"></div></div></div>').appendTo($layer);
			$squash = $player.find('.squash');
			$sprite = $player.find('.sprite');

			layout();
			spawn(state.unlocked === 0);
			updateCount();
			say(touch ? 'Use the buttons to move and jump.' : 'Arrow keys to move, Space to jump.');

			$window.on('keydown.game keyup.game', onKey);
			$window.on('blur.game', function() {
				keys.left = keys.right = false;
			});

			rememberMainSize();
			observer = new ResizeObserver(onMainResize);
			observer.observe($('#main')[0]);

			running = true;
			lastTime = window.performance.now();
			window.requestAnimationFrame(frame);
		}

		function stop() {
			if (!running)
				return;

			restoreAllText();
			running = false;
			observer.disconnect();
			$window.off('.game');
			$layer.remove();
			$(sections).removeClass('game-locked').removeAttr('inert');
			$body.removeClass('game-playing');
			levels = [];
			slabs = [];
			keys.left = keys.right = false;
		}

		function applyLocks() {
			$(sections).each(function(index) {
				var locked = index >= state.unlocked;

				$(this).toggleClass('game-locked', locked);

				if (locked)
					$(this).attr('inert', '');
				else
					$(this).removeAttr('inert');
			});
		}

		function spawn(drop) {
			var level = levels[currentIndex()];

			player.x = level.onRight ? bounds.left + 16 : bounds.right - player.width - 16;
			player.y = level.floor.top - player.height - (drop ? 240 : 0);
			player.vy = 0;
			player.grounded = !drop;
		}

		// Only when the switch is flipped; while playing, the scrolling is left to you.
		function showSpawn() {
			if (levels.length)
				window.scrollTo(0, Math.max(0, levels[currentIndex()].floor.top - window.innerHeight * 0.6));
		}

	// Levels. Each section has a floor above it, and slabs leading up to its star.

		function layout() {
			var rect = sections[0].getBoundingClientRect(),
				before = levels.length ? levels[currentIndex()].floor.top : null;

			bounds = { left: rect.left, right: rect.right };
			levels = sections.map(makeLevel);
			levels.forEach(function(level, index) {
				shapeFloor(level, index);
			});

			slabs = [];
			$layer.children().not($player).remove();

			levels.forEach(function(level, index) {
				addSlab(level.floor, 'game-slab game-floor');
				level.steps.forEach(function(step) {
					addSlab(step, 'game-slab');
				});

				if (index >= state.unlocked)
					level.star.el = $('<img class="game-star" src="images/game/star.png" alt="" />')
						.css({ left: level.star.x, top: level.star.y, width: starWidth, height: starHeight })
						.appendTo($layer)[0];

				if (index === state.unlocked - 1 && isOpen(index))
					addArrow(level);
			});

			if (before !== null) {
				player.y += levels[currentIndex()].floor.top - before;
				player.x = clamp(player.x, bounds.left, bounds.right - player.width);
			}

			watching.forEach(function(word) {
				measureWord(word, window.pageYOffset);
			});
		}

		function rememberMainSize() {
			var main = $('#main')[0];

			mainSize = { width: main.offsetWidth, height: main.offsetHeight };
		}

		// Only rebuilds the slabs when the page has really changed size.
		function onMainResize() {
			var main = $('#main')[0];

			if (main.offsetWidth === mainSize.width && main.offsetHeight === mainSize.height)
				return;

			rememberMainSize();
			layout();
		}

		function makeLevel(section, index) {
			var top = section.getBoundingClientRect().top + window.pageYOffset - floorGap,
				width = bounds.right - bounds.left,
				onRight = index % 2 === 0,
				hole = Math.min(130, width * 0.3),
				size = Math.min(180, width * 0.36),
				heights = [[90], [72, 144], [112]][index % 3],
				steps = heights.map(function(height, n) {
					var from = hole + 6 + (heights.length - 1 - n) * size * 0.75,
						left = onRight ? bounds.right - from - size : bounds.left + from;

					return { left: left, right: left + size, top: top - height, height: slabHeight };
				}),
				highest = steps[steps.length - 1];

			return {
				section: section,
				onRight: onRight,
				hole: hole,
				floor: { left: bounds.left, right: bounds.right, top: top, height: floorHeight },
				steps: steps,
				star: { x: highest.left + (size - starWidth) / 2, y: highest.top - starHeight - 14 }
			};
		}

		// An open floor stops short on the star's side, leaving a gap to drop through.
		function shapeFloor(level, index) {
			var open = isOpen(index);

			level.floor.left = bounds.left + (open && !level.onRight ? level.hole : 0);
			level.floor.right = bounds.right - (open && level.onRight ? level.hole : 0);

			if (level.floor.el)
				$(level.floor.el).css({ left: level.floor.left, width: level.floor.right - level.floor.left });
		}

		function addSlab(slab, className) {
			var n = slabs.length;

			slab.el = $('<div></div>').addClass(className).css({
				left: slab.left,
				top: slab.top,
				width: slab.right - slab.left,
				height: slab.height,
				backgroundPosition: (-173 * n) + 'px ' + (-23 * n % 90) + 'px'
			}).appendTo($layer)[0];

			slabs.push(slab);
		}

		function addArrow(level) {
			var center = level.onRight ? bounds.right - level.hole / 2 : bounds.left + level.hole / 2;

			$('<div class="game-arrow"></div>').css({ left: center - 14, top: level.floor.top - 34 }).appendTo($layer);
		}

	// Stars.

		function checkStar() {
			var level = levels[state.unlocked],
				star = level && level.star;

			if (star
			&&	player.x < star.x + starWidth + 8
			&&	player.x + player.width > star.x - 8
			&&	player.y < star.y + starHeight + 8
			&&	player.y + player.height > star.y - 8)
				collect(state.unlocked);
		}

		function collect(index) {
			var level = levels[index],
				name = $(level.section).find('h2').first().clone().find('.game-symbols').remove().end().text() || 'A new section';

			state.unlocked = index + 1;
			save();
			applyLocks();
			revealSection(level.section);
			updateCount();

			$(level.star.el).addClass('got');
			bounce([1, 1], [0.85, 1.25], [1, 1], 260);

			if (isOpen(index)) {
				shapeFloor(level, index);
				addArrow(level);
				say(name + ' unlocked! Drop through the gap to keep going.');
			}
			else
				say('You unlocked everything!');
		}

		// Messages clear themselves so they don't sit on top of the page.
		function say(text) {
			$message.text(text);
			window.clearTimeout(messageTimer);
			messageTimer = window.setTimeout(function() {
				$message.empty();
			}, 6000);
		}

		function updateCount() {
			$count.text(state.unlocked + ' / ' + sections.length);
		}

	// Locked sections show still symbols. Once unlocked, each word changes back when it is on screen.

		function randomSymbols(length) {
			var text = '';

			while (length-- > 0)
				text += symbols.charAt(Math.floor(Math.random() * symbols.length));

			return text;
		}

		function scramble(section) {
			var walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT),
				nodes = [],
				node;

			while ((node = walker.nextNode()))
				if (node.nodeValue.trim())
					nodes.push(node);

			nodes.forEach(function(textNode) {
				scrambleText(textNode, section);
			});
		}

		function scrambleText(original, section) {
			var group = { original: original, section: section, pieces: [], words: [], waiting: 0 },
				fragment = document.createDocumentFragment();

			original.nodeValue.match(/\s+|[^\s-]*-+|[^\s-]+/g).forEach(function(part) {
				var piece;

				if (/^\s+$/.test(part))
					piece = document.createTextNode(part);
				else {
					piece = makeWord(part, group);
					group.waiting++;
				}

				group.pieces.push(piece);
				fragment.appendChild(piece);
			});

			original.parentNode.replaceChild(fragment, original);
			scrambled.push(group);
		}

		function makeWord(text, group) {
			var el = wordTemplate.cloneNode(true),
				word = { el: el, length: text.length, group: group, end: 0, top: 0, bottom: 0, left: 0 };

			el.firstChild.textContent = text;
			el.lastChild.textContent = randomSymbols(word.length);
			word.symbols = el.lastChild.firstChild;
			group.words.push(word);

			return el;
		}

		function measureWord(word, scroll) {
			var rect = word.el.getBoundingClientRect();

			word.top = rect.top + scroll;
			word.bottom = rect.bottom + scroll;
			word.left = rect.left;
		}

		function revealSection(section) {
			var scroll = window.pageYOffset;

			scrambled.forEach(function(group) {
				if (group.section === section)
					group.words.forEach(function(word) {
						measureWord(word, scroll);
						watching.push(word);
					});
			});
		}

		function updateWords(time) {
			if (watching.length)
				startVisibleWords(time);

			if (decoding.length && time - lastFlicker >= scrambleSpeed) {
				lastFlicker = time;
				flicker(time);
			}
		}

		// Started a few at a time so a whole screen of words doesn't land on one frame.
		function startVisibleWords(time) {
			var scroll = window.pageYOffset,
				limit = window.innerHeight * 0.92,
				started = 0;

			watching = watching.filter(function(word) {
				if (started >= wordsPerFrame || word.top < scroll || word.bottom > scroll + limit)
					return true;

				started++;
				startWord(word, time);

				return false;
			});
		}

		// Sweeps left to right, each word fading out of its symbols just in time to finish together.
		function startWord(word, time) {
			var across = clamp((word.left - bounds.left) / (bounds.right - bounds.left), 0, 1),
				delay = (scrambleTime - fadeTime) * (0.64 + 0.27 * across + 0.09 * Math.random());

			word.el.style.setProperty('--delay', Math.round(delay) + 'ms');
			word.el.classList.add('decode');
			word.end = time + delay + fadeTime;
			decoding.push(word);
		}

		function flicker(time) {
			decoding = decoding.filter(function(word) {
				if (time >= word.end) {
					word.group.waiting--;

					if (!word.group.waiting)
						restoreText(word.group);

					return false;
				}

				if (!calm)
					word.symbols.nodeValue = randomSymbols(word.length);

				return true;
			});
		}

		function restoreText(group) {
			var first = group.pieces[0];

			first.parentNode.insertBefore(group.original, first);

			group.pieces.forEach(function(piece) {
				piece.parentNode.removeChild(piece);
			});

			scrambled.splice(scrambled.indexOf(group), 1);
		}

		function restoreAllText() {
			decoding = [];
			watching = [];
			scrambled.slice().forEach(restoreText);
		}

	// Movement and animation.

		function frame(time) {
			var dt;

			if (!running)
				return;

			dt = Math.min((time - lastTime) / 1000, 1 / 30);
			lastTime = time;

			step(dt);
			updateWords(time);
			window.requestAnimationFrame(frame);
		}

		function step(dt) {
			var direction = (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
				oldBottom = player.y + player.height,
				landing = null;

			if (direction)
				player.face = direction;

			player.x = clamp(player.x + direction * speed * dt, bounds.left, bounds.right - player.width);

			player.coyote = player.grounded ? forgiveness : player.coyote - dt;
			player.buffer -= dt;

			if (player.buffer > 0 && player.coyote > 0) {
				player.vy = -jumpSpeed;
				player.buffer = player.coyote = 0;
				bounce([1, 1], [0.88, 1.15], [1, 1], 160);
			}

			player.vy = Math.min(player.vy + gravity * dt, maxFall);
			player.y += player.vy * dt;
			player.grounded = false;

			// Slabs only catch you from above, so you can jump up through them.
				if (player.vy >= 0)
					slabs.forEach(function(slab) {
						if (player.x + player.width - 6 > slab.left
						&&	player.x + 6 < slab.right
						&&	oldBottom <= slab.top + 1
						&&	player.y + player.height >= slab.top
						&&	(!landing || slab.top < landing.top))
							landing = slab;
					});

			if (landing) {
				if (player.vy > 350)
					bounce([1, 1], [1.2, 0.78], [1, 1], 180);

				player.y = landing.top - player.height;
				player.vy = 0;
				player.grounded = true;
			}

			checkStar();
			draw(dt, direction);
		}

		function draw(dt, direction) {
			var pose;

			player.clock += dt;

			if (!player.grounded)
				pose = player.vy < 0 ? poses.jump : poses.fall;
			else if (direction)
				pose = poses.walk + Math.floor(player.clock * 9) % 2;
			else if (player.clock % 3.2 > 3.05)
				pose = poses.blink;
			else
				pose = Math.floor(player.clock * 1.6) % 2 ? poses.idleAlt : poses.idle;

			if (pose !== player.pose) {
				player.pose = pose;
				$sprite[0].style.backgroundPosition = (-pose * player.width) + 'px 0';
			}

			$player[0].style.transform = 'translate3d(' + player.x + 'px,' + player.y + 'px,0)';
			$sprite[0].style.transform = player.face < 0 ? 'scaleX(-1)' : '';
		}

		function bounce(from, middle, to, duration) {
			if (calm)
				return;

			$squash[0].animate([from, middle, to].map(function(scale) {
				return { transform: 'scale(' + scale[0] + ',' + scale[1] + ')' };
			}), { duration: duration });
		}

	// Load.

		buildInterface();
		applyTheme();

		$(document).on('portfolio:rendered', function() {
			ready = true;

			// Fetched and decoded ahead of time so the first switch-on doesn't stutter.
			if (document.fonts)
				document.fonts.load("8px 'Xirod'");

			preloaded = ['marble.png', 'character.png', 'star.png'].map(function(name) {
				var image = new Image();

				image.src = 'images/game/' + name;

				if (image.decode)
					image.decode().catch(function() {});

				return image;
			});

			if (state.on)
				start();
		});

})(jQuery);
