export async function NET_FETCH(url, options = {}) {
  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (err) {
    return { error: "network_failed", detail: err.message };
  }
}
