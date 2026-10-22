const text = document.getElementById('text');
const toast = document.getElementById('toast');
text.focus();

document.getElementById('send').addEventListener('click', async () => {
  const value = text.value.trim();
  if (!value) return;
  const later = document.getElementById('later').checked;
  try {
    await window.ba.sendNote(value, later);
    toast.textContent = later ? 'Saved for their morning 🫙' : 'Delivered 💌';
    toast.classList.add('show');
    setTimeout(() => window.close(), 1200);
  } catch (err) {
    toast.textContent = 'Could not send — are you online?';
    toast.classList.add('show');
  }
});
