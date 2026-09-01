(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PartyRoomArt = api;
})(typeof window === 'undefined' ? this : window, function () {
  'use strict';
  const artworks = Object.freeze(['invitation', 'notebook', 'giftbox', 'toolbox']);
  const urls = Object.freeze(artworks.map(name => '/room-' + name + '.png'));
  function forRoom(room, allRooms) {
    // Include archived rooms; display order, names and filters must not change art.
    const ordered = [...allRooms].sort((a, b) => Number(a.created) - Number(b.created) || String(a.id).localeCompare(String(b.id)));
    const index = room ? ordered.findIndex(item => item.id === room.id) : 0;
    return urls[Math.max(0, index) % urls.length];
  }
  return Object.freeze({urls, forRoom});
});
