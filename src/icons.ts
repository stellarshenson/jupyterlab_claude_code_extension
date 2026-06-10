import { LabIcon } from '@jupyterlab/ui-components';

const claudeSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <g class="jp-icon3" fill="#616161">
    <path d="m14.375 6.48.49.28v.209l-.14.489-5.937 1.397-.558-1.387zm0 0"/>
    <path d="m12.155 2.373.683.143.182.224.173.535-.072.342-3.983 5.447L7.81 7.737l3.673-4.82z"/>
    <path d="m8.719 1.522.419-.28.349.14.349.49-.957 5.748-.65-.441-.279-.769.49-4.33z"/>
    <path d="m4.239 1.614.43-.55L4.95 1l.558.081.275.216 2.004 4.442.724 2.11-.848.471-3.231-5.864z"/>
    <path d="m2.154 4.665-.14-.56.42-.488.488.07h.14l2.933 2.165.908.698 1.257.978-.698 1.187-.629-.489-.419-.419-4.05-2.863z"/>
    <path d="M1.316 8.296 1 7.946v-.31l.316-.108 3.562.21 3.491.279-.113.695-6.66-.346z"/>
    <path d="M3.411 11.931h-.698l-.278-.32v-.382l1.186-.838 4.82-3.068.487.833z"/>
    <path d="m4.738 13.883-.28.07-.418-.21.07-.35 4.12-5.446.558.768-3.072 4.05z"/>
    <path d="m8.23 14.581-.21.28-.419.14-.349-.28-.21-.42L8.09 8.646l.629.07z"/>
    <path d="M11.791 13.045v.558l-.07.21-.279.14-.489-.066-3.356-4.996 1.331-1.014 1.117 2.025.105.733z"/>
    <path d="m13.398 12.207.07.349-.21.279-.21-.07-1.187-.838-1.815-1.606-1.397-.978.419-1.326.698.419.42.768z"/>
    <path d="m12.49 8.645 1.746.14.419.28.279.418v.302l-.768.327-3.911-.978-1.606-.07.419-1.466 1.117.838z"/>
  </g>
</svg>`;

export const claudeIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:claude',
  svgstr: claudeSvgStr
});

const starFilledSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
  <path class="jp-icon3" fill="#616161" d="M12 2.5l2.9 6.4 7 .7-5.3 4.7 1.6 6.9L12 17.7l-6.2 3.5 1.6-6.9-5.3-4.7 7-.7z"/>
</svg>`;

export const starFilledIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:star-filled',
  svgstr: starFilledSvgStr
});

// Material-style icons matched verbatim to jupyterlab_trash_mgmt_extension so
// header/menu icons render at identical size and theme.
const refreshSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
  <path class="jp-icon3" fill="#616161" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
</svg>`;

export const refreshIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:refresh',
  svgstr: refreshSvgStr
});

const removeSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
  <path class="jp-icon3" fill="#616161" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4h-3.5z"/>
</svg>`;

export const removeIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:remove',
  svgstr: removeSvgStr
});

const shieldSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13">
  <path class="jp-icon3" fill="#616161" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
</svg>`;

export const shieldIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:shield',
  svgstr: shieldSvgStr
});

// Material "add" plus, same 16px/jp-icon3 treatment as the other header
// icons.
const addSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
  <path class="jp-icon3" fill="#616161" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
</svg>`;

export const addIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:add',
  svgstr: addSvgStr
});

// Plus with a small solid shield in the lower-right corner - the
// skip-permissions variant of the "new session" button, echoing the
// shield used on the context menu's "Resume (Skip Permissions)".
const addShieldSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
  <g class="jp-icon3" fill="#616161">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" transform="translate(-2,-2) scale(0.83)"/>
    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" transform="translate(13,12) scale(0.46)"/>
  </g>
</svg>`;

export const addShieldIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:add-shield',
  svgstr: addShieldSvgStr
});

// Funnel copied verbatim from @jupyterlab/ui-components'
// `search/filter.svg` - the same image the file browser's filter
// toggle uses. The `class="jp-icon3"` lets JupyterLab's theme drive
// the fill, so the `fill="#FFF"` on the source path becomes effectively
// inert under the standard light/dark themes.
const filterSvgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 24 24">
  <path fill="#FFF" d="M14 12v7.88c.04.3-.06.62-.29.83a.996.996 0 0 1-1.41 0l-2.01-2.01a.99.99 0 0 1-.29-.83V12h-.03L4.21 4.62a1 1 0 0 1 .17-1.4c.19-.14.4-.22.62-.22h14c.22 0 .43.08.62.22a1 1 0 0 1 .17 1.4L14.03 12z" class="jp-icon3"/>
</svg>`;

export const filterIcon = new LabIcon({
  name: 'jupyterlab_claude_code_extension:filter',
  svgstr: filterSvgStr
});
