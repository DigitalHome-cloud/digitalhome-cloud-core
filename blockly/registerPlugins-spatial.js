/* DHC Blockly plugin registry — spatial harness
 *
 * Self-contained (mirrors registerPlugins-electrical.js — neither harness
 * depends on the other's plugin file). Load AFTER Blockly, BEFORE
 * Blockly.defineBlocksWithJsonArray runs against spatial-blocks.json.
 *
 * Registered mutators
 * ───────────────────
 *   dhc_home_places_mutator     → dhcb:DigitalHome: N statement slots = places
 *                                 (buildings + outdoor areas), check rec:Architecture.
 *   dhc_building_levels_mutator → dhcb:{Detached,Row,SemiDetached,Virtual}: N
 *                                 statement slots = levels, check rec:Level.
 *   dhc_level_rooms_mutator     → dhcb:Level: N statement slots = rooms, check rec:Room.
 *   dhc_room_contents_mutator   → dhcb:Room: N VALUE slots = room contents. Accepts
 *                                 native points (dhcb:Sensor/Alarm/Setpoint, output
 *                                 "brick:Point") AND placements of electrical leaves
 *                                 (dhcb:Placement, output "leaf"). check
 *                                 ["brick:Point","leaf"].
 *
 * Also defines
 * ────────────
 *   dhcb:Placement → a code-defined value block (output "leaf") whose dropdown is
 *                    populated LIVE from the Electrical workspace's leaf registry
 *                    via window.DHC_LEAF_OPTIONS(). This is the cross-workspace
 *                    link: a socket / luminaire / point defined in Electrical is
 *                    placed into a spatial Room. A dynamic dropdown cannot be
 *                    expressed in static block JSON, which is why it lives here.
 *
 * Serialization: extraState { itemCount:N } — matches the text_join convention.
 */

(function () {
  if (typeof Blockly === 'undefined') {
    console.error('[dhc/registerPlugins-spatial] Blockly must load before this script');
    return;
  }

  /* ── Helper blocks for a gear-icon popup stack ─────────────────────────── */
  function registerHelperBlocks(containerType, containerLabel, itemType, itemLabel, colour) {
    Blockly.Blocks[containerType] = {
      init() {
        this.appendDummyInput().appendField(containerLabel);
        this.appendStatementInput('STACK');
        this.setColour(colour);
        this.contextMenu = false;
      },
    };
    Blockly.Blocks[itemType] = {
      init() {
        this.appendDummyInput().appendField(itemLabel);
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour(colour);
        this.contextMenu = false;
      },
    };
  }

  /* ── Generic variable-arity STATEMENT mutator ───────────────────────────── */
  function makeMutatorMixin(cfg) {
    return {
      itemCount_: cfg.defaultCount || 1,
      saveExtraState() { return { itemCount: this.itemCount_ }; },
      loadExtraState(state) { this.updateShape_(state.itemCount || cfg.defaultCount || 1); },
      decompose(ws) {
        const cb = ws.newBlock(cfg.containerType);
        cb.initSvg();
        let conn = cb.getInput('STACK').connection;
        for (let i = 0; i < this.itemCount_; i++) {
          const ib = ws.newBlock(cfg.itemType);
          ib.initSvg();
          conn.connect(ib.previousConnection);
          conn = ib.nextConnection;
        }
        return cb;
      },
      compose(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        const conns = [];
        while (ib && !ib.isInsertionMarker()) { conns.push(ib.valueConnection_); ib = ib.getNextBlock(); }
        for (let i = 0; i < this.itemCount_; i++) {
          const c = this.getInput(cfg.inputPrefix + i)?.connection.targetConnection;
          if (c && !conns.includes(c)) c.disconnect();
        }
        this.itemCount_ = conns.length;
        this.updateShape_(this.itemCount_);
        for (let i = 0; i < this.itemCount_; i++) {
          if (conns[i]) { const slot = this.getInput(cfg.inputPrefix + i); if (slot) slot.connection.connect(conns[i]); }
        }
      },
      saveConnections(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        let i = 0;
        while (ib) { const inp = this.getInput(cfg.inputPrefix + i); ib.valueConnection_ = inp ? inp.connection.targetConnection : null; i++; ib = ib.getNextBlock(); }
      },
      updateShape_(count) {
        let i = 0;
        while (this.getInput(cfg.inputPrefix + i)) { this.removeInput(cfg.inputPrefix + i); i++; }
        for (i = 0; i < count; i++) {
          const slot = this.appendStatementInput(cfg.inputPrefix + i).setCheck(cfg.inputCheck);
          if (cfg.perItemLabel) slot.appendField(cfg.perItemLabel + ' ' + (i + 1));
          else if (i === 0) slot.appendField(cfg.firstLabel);
        }
        this.itemCount_ = count;
      },
    };
  }

  /* ── Generic variable-arity VALUE mutator ───────────────────────────────── */
  function makeValueMutatorMixin(cfg) {
    return {
      itemCount_: cfg.defaultCount || 0,
      saveExtraState() { return { itemCount: this.itemCount_ }; },
      loadExtraState(state) { this.updateShape_(state.itemCount || cfg.defaultCount || 0); },
      decompose(ws) {
        const cb = ws.newBlock(cfg.containerType);
        cb.initSvg();
        let conn = cb.getInput('STACK').connection;
        for (let i = 0; i < this.itemCount_; i++) {
          const ib = ws.newBlock(cfg.itemType);
          ib.initSvg();
          conn.connect(ib.previousConnection);
          conn = ib.nextConnection;
        }
        return cb;
      },
      compose(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        const conns = [];
        while (ib && !ib.isInsertionMarker()) { conns.push(ib.valueConnection_); ib = ib.getNextBlock(); }
        for (let i = 0; i < this.itemCount_; i++) {
          const inp = this.getInput(cfg.inputPrefix + i);
          const tc = inp && inp.connection.targetConnection;
          if (tc && !conns.includes(tc)) tc.disconnect();
        }
        this.itemCount_ = conns.length;
        this.updateShape_(this.itemCount_);
        for (let i = 0; i < this.itemCount_; i++) {
          if (conns[i]) { const inp = this.getInput(cfg.inputPrefix + i); if (inp) inp.connection.connect(conns[i]); }
        }
      },
      saveConnections(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        let i = 0;
        while (ib) { const inp = this.getInput(cfg.inputPrefix + i); ib.valueConnection_ = inp ? inp.connection.targetConnection : null; i++; ib = ib.getNextBlock(); }
      },
      updateShape_(count) {
        let i = 0;
        while (this.getInput(cfg.inputPrefix + i)) { this.removeInput(cfg.inputPrefix + i); i++; }
        for (i = 0; i < count; i++) {
          this.appendValueInput(cfg.inputPrefix + i).setCheck(cfg.inputCheck)
            .appendField((cfg.perItemLabel || 'item') + ' ' + (i + 1));
        }
        this.itemCount_ = count;
      },
    };
  }

  function registerStatementMutator(name, cfg, helperColour, containerLabel, itemLabel) {
    registerHelperBlocks(cfg.containerType, containerLabel, cfg.itemType, itemLabel, helperColour);
    Blockly.Extensions.registerMutator(
      name, makeMutatorMixin(cfg), function () { this.updateShape_(this.itemCount_); },
      [cfg.containerType, cfg.itemType]
    );
  }

  /* ══ dhc_home_places_mutator (rec:Architecture places on a DigitalHome) ══ */
  registerStatementMutator('dhc_home_places_mutator', {
    containerType: 'dhc_places_container', itemType: 'dhc_places_item',
    inputPrefix: 'hasPart_', inputCheck: 'rec:Architecture', firstLabel: 'places', defaultCount: 1,
  }, '#f8fafc', 'digital home', 'place');

  /* ══ dhc_building_levels_mutator (rec:Level levels in a building) ══ */
  registerStatementMutator('dhc_building_levels_mutator', {
    containerType: 'dhc_levels_container', itemType: 'dhc_levels_item',
    inputPrefix: 'hasPart_', inputCheck: 'rec:Level', firstLabel: 'levels', defaultCount: 1,
  }, '#22c55e', 'building', 'level');

  /* ══ dhc_level_rooms_mutator (rec:Room rooms on a level) ══ */
  registerStatementMutator('dhc_level_rooms_mutator', {
    containerType: 'dhc_rooms_container', itemType: 'dhc_rooms_item',
    inputPrefix: 'hasPart_', inputCheck: 'rec:Room', firstLabel: 'rooms', defaultCount: 1,
  }, '#f59e0b', 'level', 'room');

  /* ══ dhc_room_contents_mutator (VALUE slots: native points + leaf placements) ══ */
  registerHelperBlocks('dhc_contents_container', 'room', 'dhc_contents_item', 'content', '#ec4899');
  Blockly.Extensions.registerMutator(
    'dhc_room_contents_mutator',
    makeValueMutatorMixin({
      containerType: 'dhc_contents_container', itemType: 'dhc_contents_item',
      inputPrefix: 'hasPoint_', inputCheck: ['brick:Point', 'leaf'], perItemLabel: 'content', defaultCount: 0,
    }),
    function () { this.updateShape_(this.itemCount_); },
    ['dhc_contents_container', 'dhc_contents_item']
  );

  /* ══════════════════════════════════════════════════════════════════════════
   *  dhcb:Placement — a cross-workspace reference to an electrical leaf.
   *  The dropdown is generated LIVE from window.DHC_LEAF_OPTIONS() (the unified
   *  page's leaf registry, projected from the Electrical workspace). Selecting a
   *  leaf links this spatial Room → that electrical socket / luminaire / point.
   * ══════════════════════════════════════════════════════════════════════════ */
  function leafOptions() {
    let reg = [];
    try { reg = (typeof window !== 'undefined' && window.DHC_LEAF_OPTIONS) ? (window.DHC_LEAF_OPTIONS() || []) : []; }
    catch (e) { /* registry not ready */ }
    const opts = reg.map((l) => [l.label, l.id]);
    // Keep the currently-stored value visible even if its leaf was deleted in
    // Electrical, so a reload never silently drops the reference.
    const cur = this && this.getValue && this.getValue();
    if (cur && cur !== 'NONE' && !opts.some((o) => o[1] === cur)) {
      opts.push(['⚠ ' + cur + ' (missing)', cur]);
    }
    if (!opts.length) opts.push(['(no electrical leaves yet)', 'NONE']);
    return opts;
  }

  Blockly.Blocks['dhcb:Placement'] = {
    init() {
      this.appendDummyInput()
        .appendField('📍 placed')
        .appendField(new Blockly.FieldDropdown(leafOptions), 'LEAF');
      this.setOutput(true, 'leaf');
      this.setColour('#3b82f6');   // electrical-blue: signals a cross-domain reference
      this.setTooltip('A reference to an electrical leaf (socket / luminaire / EV charger / appliance / point) defined in the Electrical workspace, placed into this room. On blockly→abox this becomes rec:locatedIn (the leaf is located in this room). The list is populated live from the Electrical workspace.');
      this.setHelpUrl('');
      // Block→ontology marker (opaque design-time data; the leaf's real class is
      // resolved from the referenced electrical block on translation).
      this.data = 'dhc:blocklyBlockTemplate=dhc:Placement';
    },
  };

  console.info('[dhc/registerPlugins-spatial] mutators registered: dhc_home_places_mutator, dhc_building_levels_mutator, dhc_level_rooms_mutator, dhc_room_contents_mutator; block dhcb:Placement defined');
})();
