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

// What the editor shows. Each section edits content[path], or the top level when there is no path.
const SCHEMA = [
	{
		title: 'Header',
		path: 'header',
		fields: [
			{ key: 'name', label: 'Your name' },
			{ key: 'tagline', label: 'Tagline', hint: 'One line under your name.' },
			{ key: 'avatar', label: 'Profile photo', type: 'image', maxSize: 400 },
			{ key: 'background', label: 'Background image', type: 'image', maxSize: 2000 }
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
		fields: [
			{ key: 'heading', label: 'Heading' },
			{
				key: 'items',
				type: 'list',
				itemName: 'project',
				summary: item => item.title || 'Untitled project',
				create: () => ({ title: 'New project', description: '', image: '', link: '', linkLabel: '' }),
				fields: [
					{ key: 'title', label: 'Title' },
					{ key: 'description', label: 'Description', type: 'textarea', rows: 4 },
					{ key: 'image', label: 'Image', type: 'image', maxSize: 1600 },
					{ key: 'link', label: 'Link (optional)', type: 'link', hint: 'GitHub repo, demo video, write-up…' },
					{ key: 'linkLabel', label: 'Link text', placeholder: 'View project' }
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
				create: () => ({ platform: 'github', url: '' }),
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

const state = {
	content: null,
	saved: '',                 // content as last loaded or saved, to spot unsaved changes
	files: new Map(),          // uploaded path -> data URL, so it shows before GitHub has it
	unsaved: new Set(),        // uploaded paths not sent to GitHub yet
	openItems: new WeakSet(),  // list items expanded in the editor
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

function pickFile(accept) {
	return new Promise(resolve => {
		const input = el('input', { type: 'file', accept, hidden: true });
		const done = file => { input.remove(); resolve(file); };
		input.addEventListener('change', () => done(input.files[0] || null));
		input.addEventListener('cancel', () => done(null));
		document.body.append(input);
		input.click();
	});
}

function readAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
		reader.readAsDataURL(file);
	});
}

// Big photos are scaled down so the site stays fast.
async function shrinkImage(file, maxSize) {
	const bitmap = await createImageBitmap(file).catch(() => null);
	if (!bitmap) throw new Error(`Couldn't open ${file.name}. Try a JPG or PNG.`);
	const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
	const canvas = el('canvas', { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
	canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	// PNGs keep their transparency; everything else becomes a JPG.
	return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
}

async function addUpload(file, maxSize = 1600) {
	if (file.size > MAX_UPLOAD) throw new Error(`${file.name} is over 25 MB. Pick a smaller file.`);
	const isImage = file.type.startsWith('image/');
	const resizable = isImage && !/svg|gif/.test(file.type);
	const dataUrl = resizable ? await shrinkImage(file, maxSize) : await readAsDataUrl(file);
	const ext = resizable
		? (dataUrl.startsWith('data:image/png') ? 'png' : 'jpg')
		: (file.name.includes('.') ? slug(file.name.split('.').pop()) : 'bin');
	const name = slug(file.name.replace(/\.[^.]+$/, '')) || 'file';
	const path = `${isImage ? 'images/uploads' : 'files'}/${Date.now()}-${name}.${ext}`;
	state.files.set(path, dataUrl);
	state.unsaved.add(path);
	return path;
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
	const remove = el('button', {
		type: 'button',
		className: 'btn small',
		onclick: () => { obj[f.key] = ''; refresh(); changed(); }
	}, 'Remove');

	function refresh() {
		const has = !!obj[f.key];
		img.hidden = !has;
		empty.hidden = has;
		remove.hidden = !has;
		if (has) img.src = assetSrc(obj[f.key]);
	}
	refresh();

	return field(f, el('div', { className: 'image-field' },
		el('div', { className: 'thumb' }, img, empty),
		el('div', { className: 'image-actions' },
			el('button', {
				type: 'button',
				className: 'btn small',
				onclick: async () => {
					const file = await pickFile('image/*');
					if (!file) return;
					try {
						obj[f.key] = await addUpload(file, f.maxSize);
						refresh();
						changed();
					} catch (err) {
						toast(err.message, 'error');
					}
				}
			}, 'Choose image…'),
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
				const file = await pickFile('');
				if (!file) return;
				try {
					obj[f.key] = input.value = await addUpload(file);
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
				const action = (label, name, run, disabled) => el('button', {
					type: 'button',
					className: 'icon-btn',
					title: name,
					'aria-label': name,
					disabled,
					onclick: event => { event.preventDefault(); run(); }
				}, label);

				return el('details', {
					className: 'item',
					open: state.openItems.has(item),
					ontoggle: event => event.target.open ? state.openItems.add(item) : state.openItems.delete(item)
				},
					el('summary', {}, title, el('span', { className: 'item-actions' },
						action('↑', 'Move up', () => move(i, -1), i === 0),
						action('↓', 'Move down', () => move(i, 1), i === items.length - 1),
						action('✕', `Remove ${f.itemName}`, () => {
							if (!confirm(`Remove this ${f.itemName}?`)) return;
							items.splice(i, 1);
							draw();
							changed();
						}))),
					f.fields.map(sub => renderField(item, { ...sub, onChange: () => { title.textContent = f.summary(item); } })));
			}),
			el('button', {
				type: 'button',
				className: 'btn small',
				onclick: () => {
					const item = f.create();
					items.push(item);
					state.openItems.add(item);
					draw();
					changed();
				}
			}, `+ Add ${f.itemName}`));
	}

	draw();
	return wrap;
}

// ---------------------------------------------------------------- preview

function sendPreview() {
	if (!state.content) return;
	frame.contentWindow?.postMessage({
		type: 'portfolio:preview',
		content: state.content,
		uploads: Object.fromEntries(state.files)
	}, location.origin);
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
		sendPreview();
});

new ResizeObserver(layoutPreview).observe(stage);

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
	state.saved = JSON.stringify(state.content);
	renderEditor();
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
