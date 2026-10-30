// Portfolio admin: edits content.json and saves it, along with any uploaded
// images or files, to the site's GitHub repository through the GitHub API.

const PLATFORMS = {
	github: 'GitHub',
	linkedin: 'LinkedIn',
	instagram: 'Instagram',
	twitter: 'X / Twitter',
	youtube: 'YouTube',
	email: 'Email',
	resume: 'Resume',
	website: 'Website'
};

// Shapes offered in the crop tool. NaN means any shape.
const ASPECTS = {
	free: ['Free', NaN],
	square: ['Square', 1],
	wide: ['Wide', 16 / 9],
	photo: ['4:3', 4 / 3],
	tall: ['Tall', 9 / 16]
};

const PHOTO_FIELDS = [
	{ key: 'src', label: 'Photo', type: 'image', crop: { aspects: ['free', 'photo', 'square', 'wide'] }, thumb: 'wide', maxSize: 2000, required: true },
	{ key: 'caption', label: 'Caption (optional)' }
];

const VIDEO_FIELDS = [
	{
		key: 'src',
		label: 'Video',
		type: 'link',
		accept: 'video/*',
		placeholder: 'https://www.youtube.com/watch?v=…',
		hint: 'Paste a YouTube, Vimeo or Google Drive link (works best), or upload a short clip under 25 MB.'
	},
	{ key: 'caption', label: 'Caption (optional)' }
];

// What the editor shows. Each section edits content[path], or the top level when there is no path.
const SCHEMA = [
	{
		title: 'Header',
		path: 'header',
		fields: [
			{ key: 'name', label: 'Your name' },
			{ key: 'tagline', label: 'Tagline', hint: 'Shown on its own line under your name.' },
			{ key: 'avatar', label: 'Profile photo', type: 'image', crop: { aspects: ['square'], round: true }, thumb: 'round', maxSize: 600 },
			{ key: 'background', label: 'Background image', type: 'image', crop: { aspects: ['free', 'tall', 'square', 'wide'] }, maxSize: 2000 }
		]
	},
	{
		title: 'About',
		path: 'about',
		fields: [
			{ key: 'heading', label: 'Heading' },
			{ key: 'text', label: 'Text', type: 'textarea', rows: 6, hint: 'Leave a blank line to start a new paragraph.' },
			{ key: 'buttonLabel', label: 'Button text', hint: 'For example "My resume". Leave empty to hide the button.' },
			{ key: 'buttonLink', label: 'Button link', type: 'link', hint: 'A web address, or upload a file such as a PDF.' }
		]
	},
	{
		title: 'Projects',
		path: 'projects',
		hint: 'Open a project to edit it. The preview switches to that project’s page.',
		fields: [
			{ key: 'heading', label: 'Heading' },
			{
				key: 'items',
				type: 'list',
				itemName: 'project',
				summary: item => item.title || 'Untitled project',
				thumbnail: item => item.image,
				onOpen: index => previewProject(index),
				add: [{ label: '+ Add project', run: () => [{ title: 'New project', description: '', image: '', details: '', media: [], link: '', linkLabel: '' }] }],
				fields: [
					{ key: 'title', label: 'Title' },
					{ key: 'description', label: 'Short description', type: 'textarea', rows: 3, hint: 'Shown on the project card on your home page.' },
					{ key: 'image', label: 'Cover image', type: 'image', crop: { aspects: ['wide'] }, thumb: 'wide', maxSize: 1600 },
					{ key: 'details', label: 'Full write-up', type: 'textarea', rows: 8, hint: 'Shown on the project’s own page. Leave a blank line to start a new paragraph.' },
					{
						key: 'media',
						label: 'Photos and videos',
						type: 'list',
						itemName: 'item',
						summary: item => `${item.type === 'video' ? 'Video' : 'Photo'}${item.caption ? ` · ${item.caption}` : ''}`,
						thumbnail: item => item.type === 'video' ? '' : item.src,
						fields: item => item.type === 'video' ? VIDEO_FIELDS : PHOTO_FIELDS,
						add: [
							{ label: '+ Add photos', run: addPhotos },
							{ label: '+ Add video', run: () => [{ type: 'video', src: '', caption: '' }] }
						]
					},
					{ key: 'link', label: 'Link (optional)', type: 'link', hint: 'GitHub repo, live demo, paper…' },
					{ key: 'linkLabel', label: 'Link button text', placeholder: 'Visit project' }
				]
			}
		]
	},
	{
		title: 'Contact',
		path: 'contact',
		fields: [
			{ key: 'heading', label: 'Heading' },
			{ key: 'text', label: 'Text', type: 'textarea', rows: 3 },
			{ key: 'email', label: 'Email', inputType: 'email', hint: 'Leave empty to hide.' },
			{ key: 'phone', label: 'Phone', inputType: 'tel', hint: 'Leave empty to hide.' },
			{ key: 'location', label: 'Location', placeholder: 'City, Country', hint: 'Leave empty to hide.' }
		]
	},
	{
		title: 'Social links',
		hint: 'Icons at the bottom of the page. Links without an address are hidden.',
		fields: [
			{
				key: 'social',
				type: 'list',
				itemName: 'link',
				summary: item => `${PLATFORMS[item.platform] || 'Link'}${item.url ? ` · ${item.url}` : ' (no address yet)'}`,
				add: [{ label: '+ Add link', run: () => [{ platform: 'github', url: '' }] }],
				fields: [
					{ key: 'platform', label: 'Type', type: 'select', options: PLATFORMS },
					{ key: 'url', label: 'Address', type: 'link', placeholder: 'https://…' }
				]
			}
		]
	}
];

const SETTINGS_KEY = 'portfolio-admin:github';
const MAX_UPLOAD = 25 * 1024 * 1024;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

const state = {
	content: null,
	saved: '',                 // content as last loaded or saved, to spot unsaved changes
	files: new Map(),          // uploaded path -> data URL, so it shows before GitHub has it
	unsaved: new Set(),        // uploaded paths not sent to GitHub yet
	openItems: new WeakSet(),  // list items expanded in the editor
	previewProject: null,      // project shown in the preview, or null for the home page
	device: 'desktop',
	saving: false,
	saveAfterConnect: false
};

let github = loadSettings();

const $ = id => document.getElementById(id);
const frame = $('frame');
const stage = $('stage');
const editor = $('editor');
const statusEl = $('status');
const saveBtn = $('save');
const connectBtn = $('connect');
const dialog = $('settings');
const form = $('settings-form');
const cropDialog = $('crop');

// ---------------------------------------------------------------- helpers

function el(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value == null) continue;
		if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
		else if (key in node) node[key] = value;
		else node.setAttribute(key, value);
	}
	node.append(...children.flat().filter(c => c != null && c !== false && c !== ''));
	return node;
}

function isDirty() {
	return !!state.content && JSON.stringify(state.content) !== state.saved;
}

function assetSrc(path) {
	if (state.files.has(path)) return state.files.get(path);
	if (/^(https?:|data:)/i.test(path)) return path;
	return `../${path}`;
}

function slug(text) {
	return text.toLowerCase().normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function textToBase64(text) {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

function base64ToText(base64) {
	const binary = atob(base64.replace(/\s/g, ''));
	return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
}

let toastTimer;
function toast(message, kind = 'ok') {
	const node = $('toast');
	node.textContent = message;
	node.className = `toast ${kind}`;
	node.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { node.hidden = true; }, kind === 'error' ? 9000 : 4000);
}

function updateStatus(text) {
	const dirty = isDirty();
	statusEl.textContent = text
		|| (state.saving ? 'Saving…' : dirty ? 'Unsaved changes' : github ? 'Up to date' : 'Not connected to GitHub');
	statusEl.dataset.state = state.saving ? 'busy' : dirty ? 'dirty' : github ? 'ok' : 'off';
	saveBtn.disabled = state.saving || !dirty;
	connectBtn.textContent = github ? 'GitHub settings' : 'Connect GitHub';
}

let previewTimer;
function changed() {
	updateStatus();
	clearTimeout(previewTimer);
	previewTimer = setTimeout(sendPreview, 120);
}

// ---------------------------------------------------------------- uploads

function pickFiles(accept, multiple = false) {
	return new Promise(resolve => {
		const input = el('input', { type: 'file', accept, multiple, hidden: true });
		const done = files => { input.remove(); resolve(files); };
		input.addEventListener('change', () => done([...input.files]));
		input.addEventListener('cancel', () => done([]));
		document.body.append(input);
		input.click();
	});
}

function checkSize(file) {
	if (file.size > MAX_UPLOAD) throw new Error(`${file.name} is over 25 MB. Pick a smaller file, or use a YouTube link for videos.`);
}

function readAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
		reader.readAsDataURL(file);
	});
}

// Turns a photo upright and scales it down so the site stays fast.
async function shrinkImage(file, maxSize, quality = 0.85) {
	const bitmap = await createImageBitmap(file).catch(() => null);
	if (!bitmap) throw new Error(`Couldn't open ${file.name}. Try a JPG or PNG.`);
	const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
	const canvas = el('canvas', { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
	canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	// PNGs keep their transparency; everything else becomes a JPG.
	return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
}

const canCrop = file => !/svg|gif/.test(file.type);

let lastStamp = 0;
function storeUpload(dataUrl, fileName) {
	const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
	const ext = EXTENSIONS[mime] || (fileName.includes('.') ? slug(fileName.split('.').pop()) : 'bin');
	const name = slug(fileName.replace(/\.[^.]+$/, '').replace(/^\d+-/, '')) || 'file';
	const folder = mime.startsWith('image/') ? 'images/uploads' : mime.startsWith('video/') ? 'videos' : 'files';
	lastStamp = Math.max(Date.now(), lastStamp + 1);
	const path = `${folder}/${lastStamp}-${name}.${ext}`;
	state.files.set(path, dataUrl);
	state.unsaved.add(path);
	return path;
}

// Image fields: pick a file, then crop it.
async function chooseImage(f) {
	const [file] = await pickFiles('image/*');
	if (!file) return null;
	checkSize(file);
	if (!canCrop(file)) return storeUpload(await readAsDataUrl(file), file.name);
	if (!window.Cropper) return storeUpload(await shrinkImage(file, f.maxSize), file.name);
	const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
	const cropped = await cropImage(await shrinkImage(file, 3000, 0.95), f, mime);
	return cropped && storeUpload(cropped, file.name);
}

// Crop an image that is already on the page; the result is saved as a new file.
async function recropImage(f, path) {
	if (!window.Cropper) throw new Error("The crop tool didn't load. Check your internet connection and reload the page.");
	const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
	const cropped = await cropImage(assetSrc(path), f, mime);
	return cropped && storeUpload(cropped, path.split('/').pop());
}

// Link fields: any file, e.g. a PDF or a video clip.
async function uploadFile(accept) {
	const [file] = await pickFiles(accept);
	if (!file) return null;
	checkSize(file);
	const dataUrl = file.type.startsWith('image/') && canCrop(file) ? await shrinkImage(file, 2000) : await readAsDataUrl(file);
	return storeUpload(dataUrl, file.name);
}

// "+ Add photos" takes several at once; each can be cropped afterwards.
async function addPhotos() {
	const added = [];
	for (const file of await pickFiles('image/*', true)) {
		try {
			checkSize(file);
			const dataUrl = canCrop(file) ? await shrinkImage(file, 2000) : await readAsDataUrl(file);
			added.push({ type: 'image', src: storeUpload(dataUrl, file.name), caption: '' });
		} catch (err) {
			toast(err.message, 'error');
		}
	}
	return added;
}

// ---------------------------------------------------------------- crop dialog

let cropper = null;
let cropRequest = null;

function cropImage(src, f, mime) {
	const aspects = (f.crop?.aspects || ['free']).map(key => ASPECTS[key]);
	const bar = $('crop-aspects');
	const img = el('img', { alt: '' });

	return new Promise(resolve => {
		$('crop-area').replaceChildren(img);
		cropRequest = { resolve, maxSize: f.maxSize || 1600, mime };
		cropDialog.classList.toggle('round', !!f.crop?.round);

		bar.hidden = aspects.length < 2;
		bar.replaceChildren(...aspects.map(([label, ratio], i) => el('button', {
			type: 'button',
			className: i === 0 ? 'active' : '',
			onclick: event => {
				bar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === event.currentTarget));
				cropper?.setAspectRatio(ratio);
			}
		}, label)));

		img.onload = () => {
			cropper = new Cropper(img, {
				aspectRatio: aspects[0][1],
				viewMode: 1,
				dragMode: 'move',
				autoCropArea: 1,
				background: false,
				checkOrientation: false,
				toggleDragModeOnDblclick: false
			});
		};
		img.onerror = () => finishCrop(null, "That image couldn't be opened for cropping.");
		img.crossOrigin = /^https?:/i.test(src) ? 'anonymous' : null;
		img.src = src;
		cropDialog.showModal();
	});
}

function finishCrop(result, error) {
	const request = cropRequest;
	cropRequest = null;
	cropper?.destroy();
	cropper = null;
	if (cropDialog.open) cropDialog.close();
	if (error) toast(error, 'error');
	request?.resolve(result);
}

$('crop-done').addEventListener('click', () => {
	if (!cropper || !cropRequest) return;
	const { maxSize, mime } = cropRequest;
	try {
		// Crop at full size, then scale down (Cropper's own maxWidth shrinks the photo before cropping).
		const full = cropper.getCroppedCanvas({
			imageSmoothingEnabled: true,
			imageSmoothingQuality: 'high',
			fillColor: mime === 'image/png' ? 'transparent' : '#ffffff'
		});
		const scale = Math.min(1, maxSize / Math.max(full.width, full.height));
		const canvas = el('canvas', { width: Math.round(full.width * scale), height: Math.round(full.height * scale) });
		const context = canvas.getContext('2d');
		context.imageSmoothingQuality = 'high';
		context.drawImage(full, 0, 0, canvas.width, canvas.height);
		finishCrop(canvas.toDataURL(mime, 0.88));
	} catch {
		finishCrop(null, "This image is stored on another website, so it can't be cropped here. Download it and upload it instead.");
	}
});

$('crop-cancel').addEventListener('click', () => finishCrop(null));
// Esc closes the dialog. A late close event from an earlier crop must not cancel a new one.
cropDialog.addEventListener('close', () => { if (!cropDialog.open) finishCrop(null); });

for (const button of document.querySelectorAll('[data-crop]')) {
	button.addEventListener('click', () => {
		if (!cropper) return;
		const action = button.dataset.crop;
		if (action === 'zoom-in') cropper.zoom(0.1);
		if (action === 'zoom-out') cropper.zoom(-0.1);
		if (action === 'rotate-left') cropper.rotate(-90);
		if (action === 'rotate-right') cropper.rotate(90);
		if (action === 'reset') cropper.reset();
	});
}

// ---------------------------------------------------------------- editor

function renderEditor() {
	editor.replaceChildren(...SCHEMA.map(section => {
		const obj = section.path ? (state.content[section.path] ||= {}) : state.content;
		return el('details', { className: 'card', open: true },
			el('summary', {}, section.title),
			section.hint && el('p', { className: 'hint' }, section.hint),
			section.fields.map(f => renderField(obj, f)));
	}));
}

function renderField(obj, f) {
	switch (f.type) {
		case 'list': return renderList(obj, f);
		case 'image': return renderImage(obj, f);
		case 'link': return renderLink(obj, f);
		case 'select': return field(f, renderSelect(obj, f));
		default: return field(f, textInput(obj, f));
	}
}

function field(f, control, composite = false) {
	return el(composite ? 'div' : 'label', { className: 'field' },
		f.label && el('span', { className: 'label' }, f.label),
		control,
		f.hint && el('small', { className: 'hint' }, f.hint));
}

function textInput(obj, f) {
	const props = {
		value: obj[f.key] ?? '',
		placeholder: f.placeholder,
		'aria-label': f.label,
		oninput: event => {
			obj[f.key] = event.target.value;
			f.onChange?.();
			changed();
		}
	};
	return f.type === 'textarea'
		? el('textarea', { rows: f.rows || 4, ...props })
		: el('input', { type: f.inputType || 'text', ...props });
}

function renderSelect(obj, f) {
	return el('select', {
		onchange: event => {
			obj[f.key] = event.target.value;
			f.onChange?.();
			changed();
		}
	}, Object.entries(f.options).map(([value, label]) => el('option', { value, selected: obj[f.key] === value }, label)));
}

function renderImage(obj, f) {
	const img = el('img', { alt: '' });
	const empty = el('span', { className: 'empty' }, 'No image');
	const crop = el('button', { type: 'button', className: 'btn small', onclick: () => update(() => recropImage(f, obj[f.key])) }, 'Crop…');
	const remove = el('button', { type: 'button', className: 'btn small', onclick: () => update(() => '') }, 'Remove');

	async function update(getPath) {
		try {
			const path = await getPath();
			if (path == null) return;
			obj[f.key] = path;
			refresh();
			f.onChange?.();
			changed();
		} catch (err) {
			toast(err.message, 'error');
		}
	}

	function refresh() {
		const has = !!obj[f.key];
		img.hidden = !has;
		empty.hidden = has;
		crop.hidden = !has || /\.(svg|gif)$/i.test(obj[f.key]);
		remove.hidden = !has || f.required;
		if (has) img.src = assetSrc(obj[f.key]);
	}
	refresh();

	return field(f, el('div', { className: 'image-field' },
		el('div', { className: `thumb ${f.thumb || ''}` }, img, empty),
		el('div', { className: 'image-actions' },
			el('button', { type: 'button', className: 'btn small', onclick: () => update(() => chooseImage(f)) }, 'Choose image…'),
			crop,
			remove)), true);
}

function renderLink(obj, f) {
	const input = textInput(obj, f);
	return field(f, el('div', { className: 'inline' },
		input,
		el('button', {
			type: 'button',
			className: 'btn small',
			onclick: async () => {
				try {
					const path = await uploadFile(f.accept || '');
					if (!path) return;
					obj[f.key] = input.value = path;
					f.onChange?.();
					changed();
				} catch (err) {
					toast(err.message, 'error');
				}
			}
		}, 'Upload file')), true);
}

function renderList(obj, f) {
	const items = (obj[f.key] ||= []);
	const wrap = el('div', { className: 'list' });

	function move(index, by) {
		const [item] = items.splice(index, 1);
		items.splice(index + by, 0, item);
		draw();
		changed();
	}

	function draw() {
		wrap.replaceChildren(
			...items.map((item, i) => {
				const title = el('span', { className: 'item-title' }, f.summary(item));
				const thumb = f.thumbnail && el('img', { className: 'item-thumb', alt: '' });
				const refresh = () => {
					title.textContent = f.summary(item);
					if (!thumb) return;
					const src = f.thumbnail(item);
					thumb.hidden = !src;
					if (src) thumb.src = assetSrc(src);
				};
				const action = (label, name, run, disabled) => el('button', {
					type: 'button',
					className: 'icon-btn',
					title: name,
					'aria-label': name,
					disabled,
					onclick: event => { event.preventDefault(); run(); }
				}, label);
				const fields = typeof f.fields === 'function' ? f.fields(item) : f.fields;
				refresh();

				return el('details', {
					className: 'item',
					open: state.openItems.has(item),
					// Redraws reopen items too; only a click on a closed item counts as opening it.
					ontoggle: event => {
						if (!event.target.open) state.openItems.delete(item);
						else if (!state.openItems.has(item)) {
							state.openItems.add(item);
							f.onOpen?.(i);
						}
					}
				},
					el('summary', {}, thumb, title, el('span', { className: 'item-actions' },
						action('↑', 'Move up', () => move(i, -1), i === 0),
						action('↓', 'Move down', () => move(i, 1), i === items.length - 1),
						action('✕', `Remove this ${f.itemName}`, () => {
							if (!confirm(`Remove this ${f.itemName}?`)) return;
							items.splice(i, 1);
							draw();
							changed();
						}))),
					fields.map(sub => renderField(item, { ...sub, onChange: refresh })));
			}),
			el('div', { className: 'list-actions' }, f.add.map(adder => el('button', {
				type: 'button',
				className: 'btn small',
				onclick: async () => {
					try {
						const added = await adder.run();
						if (!added?.length) return;
						items.push(...added);
						if (added.length === 1) state.openItems.add(added[0]);
						draw();
						changed();
						if (added.length === 1) f.onOpen?.(items.length - 1);
					} catch (err) {
						toast(err.message, 'error');
					}
				}
			}, adder.label))));
	}

	draw();
	return f.label ? field(f, wrap, true) : wrap;
}

// ---------------------------------------------------------------- preview

// project: a project index or null for the home page; leave it out to keep the current page.
function sendPreview(project) {
	if (!state.content) return;
	const message = { type: 'portfolio:preview', content: state.content, uploads: Object.fromEntries(state.files) };
	if (project !== undefined) message.project = project;
	frame.contentWindow?.postMessage(message, location.origin);
}

function previewProject(index) {
	state.previewProject = index;
	sendPreview(index);
}

function layoutPreview() {
	const width = state.device === 'phone' ? 390 : 1280;
	const scale = Math.min(1, stage.clientWidth / width);
	Object.assign(frame.style, {
		width: `${width}px`,
		height: `${stage.clientHeight / scale}px`,
		left: `${Math.max(0, (stage.clientWidth - width * scale) / 2)}px`,
		transform: `scale(${scale})`
	});
	stage.classList.toggle('phone', state.device === 'phone');
}

window.addEventListener('message', event => {
	if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'portfolio:ready')
		sendPreview(state.previewProject);
});

new ResizeObserver(layoutPreview).observe(stage);

$('preview-home').addEventListener('click', () => previewProject(null));

for (const button of document.querySelectorAll('button[data-device]')) {
	button.addEventListener('click', () => {
		state.device = button.dataset.device;
		document.querySelectorAll('button[data-device]').forEach(b => b.classList.toggle('active', b === button));
		layoutPreview();
	});
}

for (const button of document.querySelectorAll('.tabs button')) {
	button.addEventListener('click', () => {
		document.body.dataset.view = button.dataset.view;
		document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === button));
	});
}

// ---------------------------------------------------------------- GitHub

function loadSettings() {
	try {
		return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null;
	} catch {
		return null;
	}
}

function storeSettings(settings) {
	try {
		if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		else localStorage.removeItem(SETTINGS_KEY);
	} catch {
		// Private windows can block storage; the connection then lasts until the tab closes.
	}
}

// On yourname.github.io the repository can be worked out from the address.
function guessRepo() {
	const host = location.hostname;
	if (!host.endsWith('.github.io')) return { owner: '', repo: '' };
	const parts = location.pathname.split('/').filter(Boolean);
	return {
		owner: host.slice(0, -'.github.io'.length),
		repo: parts.length > 1 && parts[0] !== 'admin' ? parts[0] : host
	};
}

async function githubError(response) {
	let detail = '';
	try {
		detail = (await response.json()).message || '';
	} catch {}
	switch (response.status) {
		case 401: return new Error("GitHub didn't accept the access key. It may have expired or been pasted wrong. Open GitHub settings and paste a new one.");
		case 403: return new Error(`GitHub refused the change. Make sure the access key has Contents set to "Read and write" for this repository.${detail ? ` (${detail})` : ''}`);
		case 404: return new Error("GitHub couldn't find that repository or branch. Check the names in GitHub settings, and that the access key includes this repository.");
		case 409: return new Error('The site changed on GitHub while you were saving. Try saving again.');
		default: return new Error(`GitHub error ${response.status}${detail ? `: ${detail}` : ''}`);
	}
}

async function api(method, path, body) {
	const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}${path}`, {
		method,
		cache: 'no-store',
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${github.token}`,
			...(body && { 'Content-Type': 'application/json' })
		},
		body: body && JSON.stringify(body)
	});
	if (method === 'GET' && response.status === 404) return null;
	if (!response.ok) throw await githubError(response);
	return response.json();
}

function contentsPath(path) {
	return `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function getFile(path) {
	const data = await api('GET', `${contentsPath(path)}?ref=${encodeURIComponent(github.branch)}`);
	return data && { sha: data.sha, text: data.content != null ? base64ToText(data.content) : null };
}

async function putFile(path, base64, message) {
	const existing = await getFile(path);
	await api('PUT', contentsPath(path), {
		message,
		content: base64,
		branch: github.branch,
		...(existing && { sha: existing.sha })
	});
}

// ---------------------------------------------------------------- load and save

async function loadContent() {
	let text = null;

	// The repository is newer than the live site for about a minute after each save.
	if (github) {
		try {
			text = (await getFile('content.json'))?.text ?? null;
		} catch (err) {
			toast(err.message, 'error');
		}
	}

	if (text == null) {
		const response = await fetch('../content.json', { cache: 'no-store' });
		if (!response.ok) throw new Error(`content.json could not be loaded (error ${response.status}).`);
		text = await response.text();
	}

	state.content = JSON.parse(text);
	renderEditor();
	// The editor fills in empty lists and sections, so compare against the content after that.
	state.saved = JSON.stringify(state.content);
	updateStatus();
	sendPreview();
}

async function save() {
	if (state.saving || !isDirty()) return;

	if (!github) {
		state.saveAfterConnect = true;
		openSettings();
		return;
	}

	state.saving = true;
	updateStatus();

	const snapshot = JSON.stringify(state.content);
	try {
		for (const path of [...state.unsaved]) {
			// Skip files that were replaced or removed before saving.
			if (snapshot.includes(JSON.stringify(path))) {
				updateStatus(`Uploading ${path.split('/').pop()}…`);
				const dataUrl = state.files.get(path);
				await putFile(path, dataUrl.slice(dataUrl.indexOf(',') + 1), `Upload ${path}`);
			}
			state.unsaved.delete(path);
		}

		updateStatus('Saving…');
		await putFile('content.json', textToBase64(JSON.stringify(JSON.parse(snapshot), null, '\t') + '\n'), 'Update site content');

		state.saved = snapshot;
		toast('Saved! Your live site will update in about a minute.');
	} catch (err) {
		toast(err.message, 'error');
	} finally {
		state.saving = false;
		updateStatus();
	}
}

// ---------------------------------------------------------------- settings dialog

function showSettingsError(message) {
	const node = $('settings-error');
	node.textContent = message;
	node.hidden = !message;
}

function openSettings() {
	const guess = guessRepo();
	form.owner.value = github?.owner || guess.owner;
	form.repo.value = github?.repo || guess.repo;
	form.branch.value = github?.branch || 'main';
	form.token.value = github?.token || '';
	$('disconnect').hidden = !github;
	showSettingsError('');
	dialog.showModal();
}

form.addEventListener('submit', async event => {
	event.preventDefault();

	const submit = $('settings-submit');
	const candidate = {
		owner: form.owner.value.trim(),
		repo: form.repo.value.trim(),
		branch: form.branch.value.trim() || 'main',
		token: form.token.value.trim()
	};
	const previous = github;

	submit.disabled = true;
	submit.textContent = 'Checking…';
	showSettingsError('');
	github = candidate;

	try {
		if (!await api('GET', ''))
			throw new Error(`Couldn't find github.com/${candidate.owner}/${candidate.repo}. Check the names, and that the access key includes this repository.`);
		if (!await api('GET', `/branches/${encodeURIComponent(candidate.branch)}`))
			throw new Error(`The repository has no branch called "${candidate.branch}".`);

		storeSettings(candidate);
		const andSave = state.saveAfterConnect;
		dialog.close();
		toast('Connected to GitHub.');
		updateStatus();
		if (andSave) save();
		else if (!isDirty()) loadContent().catch(err => toast(err.message, 'error'));
	} catch (err) {
		github = previous;
		showSettingsError(err.message);
	} finally {
		submit.disabled = false;
		submit.textContent = 'Connect';
	}
});

dialog.addEventListener('close', () => { state.saveAfterConnect = false; });
$('settings-cancel').addEventListener('click', () => dialog.close());

$('disconnect').addEventListener('click', () => {
	github = null;
	storeSettings(null);
	dialog.close();
	updateStatus();
	toast('Disconnected. The access key was removed from this browser.');
});

// ---------------------------------------------------------------- start

connectBtn.addEventListener('click', openSettings);
saveBtn.addEventListener('click', save);

document.addEventListener('keydown', event => {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
		event.preventDefault();
		save();
	}
});

window.addEventListener('beforeunload', event => {
	if (isDirty()) event.preventDefault();
});

updateStatus();
loadContent().catch(err => {
	updateStatus('Could not load');
	editor.replaceChildren(el('p', { className: 'error' },
		`${err.message} Open this page from your website (for example https://yourname.github.io/admin/), not as a file on your computer.`));
});
