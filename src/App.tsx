import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Rocket,
  Shield,
  Zap,
  Flame,
  Trophy,
  Coins,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Crosshair,
  Heart,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { gameAudio } from './audio';

type ScreenMode = 'menu' | 'hangar' | 'playing';

interface ShipConfig {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  accent: string;
  baseHp: number;
  baseDamage: number;
  fireRateBonus: number;
  unlockCost: number;
}

const SHIPS: ShipConfig[] = [
  {
    id: 'vanguard',
    name: 'Vanguard X-1',
    subtitle: 'Balanced Interceptor',
    color: '#38bdf8',
    accent: '#0284c7',
    baseHp: 100,
    baseDamage: 14,
    fireRateBonus: 1,
    unlockCost: 0,
  },
  {
    id: 'phantom',
    name: 'Phantom Striker',
    subtitle: 'Hyper Fire-Rate Twin Laser',
    color: '#a855f7',
    accent: '#7e22ce',
    baseHp: 90,
    baseDamage: 12,
    fireRateBonus: 1.35,
    unlockCost: 150,
  },
  {
    id: 'titan',
    name: 'Titan Heavy',
    subtitle: 'Armored Plasma Destroyer',
    color: '#10b981',
    accent: '#047857',
    baseHp: 150,
    baseDamage: 22,
    fireRateBonus: 0.95,
    unlockCost: 350,
  },
];

interface SavedProgress {
  highScore: number;
  bestWave: number;
  coins: number;
  selectedShip: string;
  unlockedShips: string[];
  upgrades: {
    damageLv: number;
    fireRateLv: number;
    hullLv: number;
    shieldLv: number;
  };
}

const STORAGE_KEY = 'nova_strike_save_v1';

const DEFAULT_PROGRESS: SavedProgress = {
  highScore: 0,
  bestWave: 1,
  coins: 50,
  selectedShip: 'vanguard',
  unlockedShips: ['vanguard'],
  upgrades: {
    damageLv: 1,
    fireRateLv: 1,
    hullLv: 1,
    shieldLv: 1,
  },
};

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  color: string;
  isEnemy: boolean;
}

type EnemyKind = 'scout' | 'kamikaze' | 'cruiser' | 'sniper' | 'boss';

interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  color: string;
  shootTimer: number;
  scoreValue: number;
  phase: number;
}

type PowerUpKind = 'weapon' | 'shield' | 'heal' | 'overdrive' | 'bomb' | 'coin';

interface PowerUp {
  x: number;
  y: number;
  vy: number;
  kind: PowerUpKind;
  radius: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
}

export default function App() {
  const [progress, setProgress] = useState<SavedProgress>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULT_PROGRESS, ...JSON.parse(raw) } : DEFAULT_PROGRESS;
    } catch {
      return DEFAULT_PROGRESS;
    }
  });

  const [screen, setScreen] = useState<ScreenMode>('menu');
  const [soundOn, setSoundOn] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);

  // HUD live states
  const [hudScore, setHudScore] = useState(0);
  const [hudCoins, setHudCoins] = useState(0);
  const [hudWave, setHudWave] = useState(1);
  const [hudHp, setHudHp] = useState(100);
  const [hudMaxHp, setHudMaxHp] = useState(100);
  const [hudShield, setHudShield] = useState(0);
  const [hudWeaponLv, setHudWeaponLv] = useState(1);
  const [hudBombs, setHudBombs] = useState(2);
  const [hudBoss, setHudBoss] = useState<{ name: string; hp: number; maxHp: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const triggerBombRef = useRef<() => void>(() => {});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // ignore storage errors
    }
  }, [progress]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    gameAudio.enabled = next;
  };

  const currentShip = SHIPS.find((s) => s.id === progress.selectedShip) || SHIPS[0];

  const startNewGame = useCallback(() => {
    setIsGameOver(false);
    setIsPaused(false);
    setScreen('playing');
  }, []);

  // Main 60FPS Canvas Game Engine
  useEffect(() => {
    if (screen !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId = 0;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Compute stats from ship + upgrades
    const ship = SHIPS.find((s) => s.id === progress.selectedShip) || SHIPS[0];
    const maxHp = ship.baseHp + (progress.upgrades.hullLv - 1) * 25;
    const baseDamage = ship.baseDamage + (progress.upgrades.damageLv - 1) * 4;
    const fireIntervalFrames = Math.max(
      5,
      Math.round(14 / (ship.fireRateBonus + (progress.upgrades.fireRateLv - 1) * 0.15))
    );

    const player = {
      x: width / 2,
      y: height - 120,
      targetX: width / 2,
      targetY: height - 120,
      radius: 20,
      hp: maxHp,
      maxHp,
      shield: (progress.upgrades.shieldLv - 1) * 25,
      weaponLv: 1,
      overdriveFrames: 0,
      bombs: 2,
      invulnerableFrames: 0,
    };

    let score = 0;
    let runCoins = 0;
    let wave = 1;
    let waveProgressKills = 0;
    let waveRequiredKills = 12;
    let bossActive = false;
    let frameCount = 0;
    let shakeFrames = 0;
    let enemyIdCounter = 1;

    setHudScore(0);
    setHudCoins(0);
    setHudWave(1);
    setHudHp(player.hp);
    setHudMaxHp(player.maxHp);
    setHudShield(player.shield);
    setHudWeaponLv(1);
    setHudBombs(player.bombs);
    setHudBoss(null);

    // Stars background
    const stars = Array.from({ length: 85 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2.2 + 0.5,
      speed: Math.random() * 2.5 + 0.6,
      alpha: Math.random() * 0.7 + 0.3,
    }));

    const bullets: Bullet[] = [];
    const enemies: Enemy[] = [];
    const powerUps: PowerUp[] = [];
    const particles: Particle[] = [];
    const floatingTexts: FloatingText[] = [];

    const spawnParticles = (x: number, y: number, color: string, count = 16, speedScale = 1) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (Math.random() * 4 + 1) * speedScale;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: Math.random() * 3 + 1.5,
          color,
          alpha: 1,
          decay: Math.random() * 0.03 + 0.02,
        });
      }
    };

    const addFloatingText = (x: number, y: number, text: string, color = '#38bdf8') => {
      floatingTexts.push({ x, y, text, color, alpha: 1 });
    };

    // Mega Bomb handler
    triggerBombRef.current = () => {
      if (player.bombs <= 0 || isPaused || isGameOver) return;
      player.bombs -= 1;
      setHudBombs(player.bombs);
      shakeFrames = 22;
      gameAudio.playNovaBomb();
      addFloatingText(width / 2, height / 2, 'NOVA BLAST!', '#f59e0b');

      // Clear all enemy bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        if (bullets[i].isEnemy) bullets.splice(i, 1);
      }

      // Damage all enemies on screen
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.hp -= 180 + wave * 35;
        spawnParticles(e.x, e.y, '#f59e0b', 20, 1.4);
      }
    };

    // Touch / Pointer Controls with finger offset so finger never blocks the ship
    let isPointerDown = false;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;

    const handlePointerDown = (clientX: number, clientY: number) => {
      isPointerDown = true;
      pointerOffsetX = player.x - clientX;
      pointerOffsetY = player.y - clientY;
      // If user tapped far from ship, pull ship gently toward tap with slight upward offset
      if (Math.hypot(pointerOffsetX, pointerOffsetY) > 130) {
        pointerOffsetX = 0;
        pointerOffsetY = -55;
      }
    };

    const handlePointerMove = (clientX: number, clientY: number) => {
      if (!isPointerDown) return;
      player.targetX = Math.max(24, Math.min(width - 24, clientX + pointerOffsetX));
      player.targetY = Math.max(70, Math.min(height - 90, clientY + pointerOffsetY));
    };

    const handlePointerUp = () => {
      isPointerDown = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handlePointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onMouseDown = (e: MouseEvent) => handlePointerDown(e.clientX, e.clientY);
    const onMouseMove = (e: MouseEvent) => handlePointerMove(e.clientX, e.clientY);

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', handlePointerUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', handlePointerUp);

    const spawnEnemy = () => {
      if (bossActive) return;

      if (waveProgressKills >= waveRequiredKills) {
        // Spawn Wave Boss!
        bossActive = true;
        gameAudio.playBossWarning();
        const bossHp = 450 + wave * 320;
        const bossName = `DREADNOUGHT MK-${wave}`;
        enemies.push({
          id: enemyIdCounter++,
          kind: 'boss',
          x: width / 2,
          y: -60,
          vx: 2.2,
          vy: 1.2,
          radius: 46,
          hp: bossHp,
          maxHp: bossHp,
          color: '#f43f5e',
          shootTimer: 0,
          scoreValue: 1000 * wave,
          phase: 0,
        });
        setHudBoss({ name: bossName, hp: bossHp, maxHp: bossHp });
        addFloatingText(width / 2, height * 0.35, `WARNING: ${bossName}`, '#f43f5e');
        return;
      }

      const roll = Math.random();
      const x = 35 + Math.random() * (width - 70);
      if (roll < 0.45) {
        enemies.push({
          id: enemyIdCounter++,
          kind: 'scout',
          x,
          y: -30,
          vx: (Math.random() - 0.5) * 1.6,
          vy: 2.2 + wave * 0.22,
          radius: 17,
          hp: 22 + wave * 8,
          maxHp: 22 + wave * 8,
          color: '#fb7185',
          shootTimer: Math.floor(Math.random() * 50),
          scoreValue: 100,
          phase: Math.random() * Math.PI * 2,
        });
      } else if (roll < 0.72) {
        enemies.push({
          id: enemyIdCounter++,
          kind: 'kamikaze',
          x,
          y: -30,
          vx: 0,
          vy: 3.6 + wave * 0.28,
          radius: 15,
          hp: 16 + wave * 6,
          maxHp: 16 + wave * 6,
          color: '#f97316',
          shootTimer: 999,
          scoreValue: 130,
          phase: 0,
        });
      } else if (roll < 0.9) {
        enemies.push({
          id: enemyIdCounter++,
          kind: 'sniper',
          x,
          y: -30,
          vx: (Math.random() - 0.5) * 2.2,
          vy: 1.7 + wave * 0.15,
          radius: 19,
          hp: 36 + wave * 12,
          maxHp: 36 + wave * 12,
          color: '#c084fc',
          shootTimer: 30,
          scoreValue: 180,
          phase: 0,
        });
      } else {
        enemies.push({
          id: enemyIdCounter++,
          kind: 'cruiser',
          x,
          y: -40,
          vx: (Math.random() - 0.5) * 0.8,
          vy: 1.2 + wave * 0.1,
          radius: 26,
          hp: 75 + wave * 24,
          maxHp: 75 + wave * 24,
          color: '#eab308',
          shootTimer: 25,
          scoreValue: 300,
          phase: 0,
        });
      }
    };

    const firePlayerWeapons = () => {
      const lv = player.weaponLv;
      const dmg = baseDamage * (player.overdriveFrames > 0 ? 1.25 : 1);
      const color = player.overdriveFrames > 0 ? '#facc15' : ship.color;
      gameAudio.playLaser(lv);

      const addBullet = (offsetX: number, offsetY: number, vx: number, vy = -12) => {
        bullets.push({
          x: player.x + offsetX,
          y: player.y + offsetY,
          vx,
          vy,
          radius: lv >= 4 ? 4.5 : 3.5,
          damage: dmg,
          color,
          isEnemy: false,
        });
      };

      if (lv === 1) {
        addBullet(0, -22, 0);
      } else if (lv === 2) {
        addBullet(-10, -18, 0);
        addBullet(10, -18, 0);
      } else if (lv === 3) {
        addBullet(0, -24, 0);
        addBullet(-12, -16, -1.4);
        addBullet(12, -16, 1.4);
      } else if (lv === 4) {
        addBullet(-7, -24, 0);
        addBullet(7, -24, 0);
        addBullet(-16, -14, -2.1);
        addBullet(16, -14, 2.1);
      } else {
        addBullet(0, -26, 0, -13);
        addBullet(-10, -22, -1.1, -12.5);
        addBullet(10, -22, 1.1, -12.5);
        addBullet(-20, -14, -2.6, -11.5);
        addBullet(20, -14, 2.6, -11.5);
      }
    };

    const maybeDropLoot = (x: number, y: number, isBoss = false) => {
      if (isBoss) {
        const bossDrops: PowerUpKind[] = ['weapon', 'heal', 'shield', 'bomb', 'coin', 'coin'];
        bossDrops.forEach((kind, i) => {
          powerUps.push({
            x: x + (i - 2.5) * 22,
            y,
            vy: 2.2,
            kind,
            radius: 13,
          });
        });
        return;
      }

      const roll = Math.random();
      if (roll < 0.35) {
        powerUps.push({ x, y, vy: 2.3, kind: 'coin', radius: 11 });
      } else if (roll < 0.43) {
        powerUps.push({ x, y, vy: 2.0, kind: 'weapon', radius: 13 });
      } else if (roll < 0.49) {
        powerUps.push({ x, y, vy: 2.0, kind: 'heal', radius: 13 });
      } else if (roll < 0.54) {
        powerUps.push({ x, y, vy: 2.0, kind: 'shield', radius: 13 });
      } else if (roll < 0.58) {
        powerUps.push({ x, y, vy: 2.1, kind: 'overdrive', radius: 13 });
      } else if (roll < 0.6) {
        powerUps.push({ x, y, vy: 2.0, kind: 'bomb', radius: 13 });
      }
    };

    const damagePlayer = (amount: number) => {
      if (player.invulnerableFrames > 0) return;
      player.invulnerableFrames = 35;
      shakeFrames = 12;
      gameAudio.playExplosion(false);

      if (player.shield > 0) {
        const absorbed = Math.min(player.shield, amount);
        player.shield -= absorbed;
        const rem = amount - absorbed;
        player.hp = Math.max(0, player.hp - rem);
        setHudShield(Math.round(player.shield));
      } else {
        player.hp = Math.max(0, player.hp - amount);
      }
      setHudHp(Math.round(player.hp));

      if (player.hp <= 0) {
        gameAudio.playExplosion(true);
        spawnParticles(player.x, player.y, '#ef4444', 45, 1.8);
        setIsGameOver(true);
        setProgress((prev) => ({
          ...prev,
          highScore: Math.max(prev.highScore, score),
          bestWave: Math.max(prev.bestWave, wave),
          coins: prev.coins + runCoins,
        }));
      }
    };

    const loop = () => {
      animationId = requestAnimationFrame(loop);

      // Draw background even when paused
      ctx.save();
      if (shakeFrames > 0) {
        shakeFrames--;
        ctx.translate((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      }

      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);

      // Update & draw stars
      for (const s of stars) {
        s.y += s.speed;
        if (s.y > height) {
          s.y = 0;
          s.x = Math.random() * width;
        }
        ctx.fillStyle = `rgba(226, 232, 240, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (player.hp <= 0) {
        ctx.restore();
        return;
      }

      frameCount++;
      if (player.invulnerableFrames > 0) player.invulnerableFrames--;
      if (player.overdriveFrames > 0) player.overdriveFrames--;

      // Smooth player movement
      player.x += (player.targetX - player.x) * 0.24;
      player.y += (player.targetY - player.y) * 0.24;

      // Auto-fire
      const currentFireInterval =
        player.overdriveFrames > 0
          ? Math.max(4, Math.floor(fireIntervalFrames * 0.55))
          : fireIntervalFrames;
      if (frameCount % currentFireInterval === 0) {
        firePlayerWeapons();
      }

      // Spawn enemies
      const spawnRate = Math.max(24, 68 - wave * 5);
      if (frameCount % spawnRate === 0) {
        spawnEnemy();
      }

      // Draw Player Starfighter
      ctx.save();
      ctx.translate(player.x, player.y);
      if (player.invulnerableFrames % 4 < 2) {
        // Thruster flame
        ctx.fillStyle = player.overdriveFrames > 0 ? '#facc15' : '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(-7, 16);
        ctx.lineTo(0, 28 + Math.random() * 9);
        ctx.lineTo(7, 16);
        ctx.closePath();
        ctx.fill();

        // Ship Hull
        ctx.fillStyle = ship.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -24);
        ctx.lineTo(20, 16);
        ctx.lineTo(6, 11);
        ctx.lineTo(0, 18);
        ctx.lineTo(-6, 11);
        ctx.lineTo(-20, 16);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cockpit
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.ellipse(0, -4, 4, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Shield bubble
      if (player.shield > 0) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Update & draw bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        if (b.y < -30 || b.y > height + 30 || b.x < -30 || b.x > width + 30) {
          bullets.splice(i, 1);
          continue;
        }

        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();

        if (b.isEnemy) {
          if (Math.hypot(b.x - player.x, b.y - player.y) < b.radius + player.radius - 4) {
            bullets.splice(i, 1);
            damagePlayer(b.damage);
          }
        }
      }

      // Update & draw enemies
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];

        if (e.kind === 'boss') {
          if (e.y < 115) {
            e.y += e.vy;
          } else {
            e.x += e.vx;
            if (e.x < 65 || e.x > width - 65) e.vx *= -1;
          }
          e.shootTimer++;
          if (e.shootTimer % 42 === 0) {
            // Radial burst
            for (let k = -2; k <= 2; k++) {
              bullets.push({
                x: e.x + k * 12,
                y: e.y + 30,
                vx: k * 1.3,
                vy: 5.2,
                radius: 5,
                damage: 18,
                color: '#fb7185',
                isEnemy: true,
              });
            }
          }
        } else if (e.kind === 'kamikaze') {
          const angle = Math.atan2(player.y - e.y, player.x - e.x);
          e.x += Math.cos(angle) * 2.1;
          e.y += e.vy;
        } else {
          e.x += e.vx + Math.sin(frameCount * 0.04 + e.phase) * 0.9;
          e.y += e.vy;
          if (e.x < 24 || e.x > width - 24) e.vx *= -1;

          e.shootTimer++;
          const shootFreq = e.kind === 'sniper' ? 75 : e.kind === 'cruiser' ? 65 : 110;
          if (e.shootTimer % shootFreq === 0 && e.y > 20 && e.y < height * 0.65) {
            const angle =
              e.kind === 'sniper'
                ? Math.atan2(player.y - e.y, player.x - e.x)
                : Math.PI / 2;
            const speed = e.kind === 'sniper' ? 6.2 : 4.6;
            bullets.push({
              x: e.x,
              y: e.y + e.radius,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              radius: 4,
              damage: 14,
              color: e.color,
              isEnemy: true,
            });
          }
        }

        if (e.y > height + 60) {
          enemies.splice(i, 1);
          continue;
        }

        // Check player bullets hitting this enemy
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (b.isEnemy) continue;
          if (Math.hypot(b.x - e.x, b.y - e.y) < b.radius + e.radius) {
            e.hp -= b.damage;
            bullets.splice(j, 1);
            spawnParticles(b.x, b.y, b.color, 4, 0.6);
            break;
          }
        }

        // Check collision with player ship
        if (Math.hypot(e.x - player.x, e.y - player.y) < e.radius + player.radius - 4) {
          damagePlayer(24);
          if (e.kind !== 'boss') {
            e.hp = 0;
          }
        }

        if (e.kind === 'boss') {
          setHudBoss({
            name: `DREADNOUGHT MK-${wave}`,
            hp: Math.max(0, Math.round(e.hp)),
            maxHp: e.maxHp,
          });
        }

        if (e.hp <= 0) {
          const wasBoss = e.kind === 'boss';
          gameAudio.playExplosion(wasBoss);
          spawnParticles(e.x, e.y, e.color, wasBoss ? 50 : 18, wasBoss ? 1.8 : 1);
          score += e.scoreValue;
          setHudScore(score);
          maybeDropLoot(e.x, e.y, wasBoss);
          enemies.splice(i, 1);

          if (wasBoss) {
            bossActive = false;
            setHudBoss(null);
            wave += 1;
            waveProgressKills = 0;
            waveRequiredKills = 12 + wave * 4;
            setHudWave(wave);
            addFloatingText(width / 2, height * 0.4, `WAVE ${wave} UNLOCKED!`, '#10b981');
          } else {
            waveProgressKills += 1;
          }
          continue;
        }

        // Draw Enemy Ship
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.fillStyle = e.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;

        if (e.kind === 'boss') {
          ctx.beginPath();
          ctx.moveTo(0, 42);
          ctx.lineTo(46, -10);
          ctx.lineTo(28, -36);
          ctx.lineTo(-28, -36);
          ctx.lineTo(-46, -10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(0, e.radius);
          ctx.lineTo(e.radius, -e.radius * 0.8);
          ctx.lineTo(0, -e.radius * 0.35);
          ctx.lineTo(-e.radius, -e.radius * 0.8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Mini HP bar if damaged
          if (e.hp < e.maxHp) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            ctx.fillRect(-16, -e.radius - 10, 32, 4);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-16, -e.radius - 10, 32 * (e.hp / e.maxHp), 4);
          }
        }
        ctx.restore();
      }

      // Update & draw power-ups
      for (let i = powerUps.length - 1; i >= 0; i--) {
        const p = powerUps[i];
        // Slight magnetic pull toward player when close
        const dist = Math.hypot(player.x - p.x, player.y - p.y);
        if (dist < 135) {
          p.x += ((player.x - p.x) / dist) * 4.5;
          p.y += ((player.y - p.y) / dist) * 4.5;
        } else {
          p.y += p.vy;
        }

        if (p.y > height + 30) {
          powerUps.splice(i, 1);
          continue;
        }

        if (dist < player.radius + p.radius + 4) {
          if (p.kind === 'coin') {
            gameAudio.playCoin();
            runCoins += 5;
            score += 50;
            setHudCoins(runCoins);
            setHudScore(score);
            addFloatingText(p.x, p.y, '+5 COINS', '#facc15');
          } else {
            gameAudio.playPowerUp();
            if (p.kind === 'weapon') {
              player.weaponLv = Math.min(5, player.weaponLv + 1);
              setHudWeaponLv(player.weaponLv);
              addFloatingText(p.x, p.y, `WEAPON LV.${player.weaponLv}!`, '#38bdf8');
            } else if (p.kind === 'heal') {
              player.hp = Math.min(player.maxHp, player.hp + 35);
              setHudHp(Math.round(player.hp));
              addFloatingText(p.x, p.y, '+35 HULL', '#10b981');
            } else if (p.kind === 'shield') {
              player.shield = Math.min(100, player.shield + 40);
              setHudShield(Math.round(player.shield));
              addFloatingText(p.x, p.y, '+SHIELD', '#60a5fa');
            } else if (p.kind === 'overdrive') {
              player.overdriveFrames = 360;
              addFloatingText(p.x, p.y, 'OVERDRIVE!', '#facc15');
            } else if (p.kind === 'bomb') {
              player.bombs = Math.min(5, player.bombs + 1);
              setHudBombs(player.bombs);
              addFloatingText(p.x, p.y, '+1 NOVA BOMB', '#f97316');
            }
          }
          powerUps.splice(i, 1);
          continue;
        }

        // Draw PowerUp Orb
        ctx.save();
        ctx.translate(p.x, p.y);
        const colors: Record<PowerUpKind, string> = {
          coin: '#facc15',
          weapon: '#38bdf8',
          heal: '#10b981',
          shield: '#60a5fa',
          overdrive: '#a855f7',
          bomb: '#f97316',
        };
        const labels: Record<PowerUpKind, string> = {
          coin: '$',
          weapon: 'W',
          heal: '+',
          shield: 'S',
          overdrive: '⚡',
          bomb: 'B',
        };
        ctx.fillStyle = colors[p.kind];
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#020617';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[p.kind], 0, 1);
        ctx.restore();
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.alpha -= pt.decay;
        if (pt.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = Math.max(0, pt.alpha);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Floating texts
      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.y -= 1.1;
        ft.alpha -= 0.02;
        if (ft.alpha <= 0) {
          floatingTexts.splice(i, 1);
          continue;
        }
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = Math.max(0, ft.alpha);
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', handlePointerUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [screen, progress.selectedShip, progress.upgrades]);

  const buyUpgrade = (key: keyof SavedProgress['upgrades'], cost: number) => {
    if (progress.coins < cost) return;
    gameAudio.playPowerUp();
    setProgress((prev) => ({
      ...prev,
      coins: prev.coins - cost,
      upgrades: {
        ...prev.upgrades,
        [key]: prev.upgrades[key] + 1,
      },
    }));
  };

  const selectOrUnlockShip = (ship: ShipConfig) => {
    const isUnlocked = progress.unlockedShips.includes(ship.id);
    if (isUnlocked) {
      gameAudio.playCoin();
      setProgress((prev) => ({ ...prev, selectedShip: ship.id }));
      return;
    }
    if (progress.coins >= ship.unlockCost) {
      gameAudio.playPowerUp();
      setProgress((prev) => ({
        ...prev,
        coins: prev.coins - ship.unlockCost,
        unlockedShips: [...prev.unlockedShips, ship.id],
        selectedShip: ship.id,
      }));
    }
  };

  return (
    <div className="relative w-full h-full bg-slate-950 text-white overflow-hidden select-none">
      {/* MENU SCREEN */}
      {screen === 'menu' && (
        <div className="flex flex-col justify-between h-full max-w-md mx-auto px-5 py-6 overflow-y-auto">
          {/* Top Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold">
              <Coins className="w-4 h-4 text-amber-400" />
              <span>{progress.coins} Coins</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300">
                <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                <span>Best: {progress.highScore.toLocaleString()}</span>
              </div>
              <button
                onClick={toggleSound}
                className="p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-300"
              >
                {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Hero Title */}
          <div className="text-center my-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-bold uppercase tracking-widest mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Arcade Space Shooter</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              NOVA STRIKE
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Touch & drag to pilot · Destroy Dreadnought Bosses · Upgrade Starfighters
            </p>
          </div>

          {/* Starfighter Selector */}
          <div className="space-y-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
              Select Starfighter
            </h2>
            {SHIPS.map((ship) => {
              const unlocked = progress.unlockedShips.includes(ship.id);
              const selected = progress.selectedShip === ship.id;
              return (
                <div
                  key={ship.id}
                  onClick={() => selectOrUnlockShip(ship)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                    selected
                      ? 'bg-slate-900 border-sky-500 shadow-lg shadow-sky-950/50'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `${ship.color}22`, border: `1px solid ${ship.color}` }}
                    >
                      <Rocket className="w-5 h-5" style={{ color: ship.color }} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{ship.name}</h3>
                      <p className="text-xs text-slate-400">{ship.subtitle}</p>
                    </div>
                  </div>

                  {unlocked ? (
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                        selected
                          ? 'bg-sky-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {selected ? 'Equipped' : 'Select'}
                    </span>
                  ) : (
                    <button
                      className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg ${
                        progress.coins >= ship.unlockCost
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      <Coins className="w-3.5 h-3.5" />
                      <span>{ship.unlockCost}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5 mt-4">
            <button
              onClick={startNewGame}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 active:scale-[0.98] text-white font-black text-base tracking-wide shadow-xl shadow-sky-950/60 flex items-center justify-center gap-2 transition-all"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>LAUNCH MISSION</span>
            </button>

            <button
              onClick={() => setScreen('hangar')}
              className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-bold text-sm flex items-center justify-center gap-2 transition-all"
            >
              <Wrench className="w-4 h-4 text-amber-400" />
              <span>UPGRADE HANGAR ({progress.coins} Coins)</span>
            </button>
          </div>
        </div>
      )}

      {/* UPGRADE HANGAR SCREEN */}
      {screen === 'hangar' && (
        <div className="flex flex-col justify-between h-full max-w-md mx-auto px-5 py-6 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-black text-white">Ship Hangar</h1>
                <p className="text-xs text-slate-400">Permanent upgrades for all missions</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold">
                <Coins className="w-4 h-4 text-amber-400" />
                <span>{progress.coins}</span>
              </div>
            </div>

            <div className="space-y-3">
              {[
                {
                  key: 'damageLv' as const,
                  title: 'Plasma Cannon Damage',
                  desc: '+4 base laser damage per level',
                  icon: <Crosshair className="w-5 h-5 text-rose-400" />,
                  lv: progress.upgrades.damageLv,
                },
                {
                  key: 'fireRateLv' as const,
                  title: 'Rapid Fire Thrusters',
                  desc: '+15% faster firing speed per level',
                  icon: <Zap className="w-5 h-5 text-amber-400" />,
                  lv: progress.upgrades.fireRateLv,
                },
                {
                  key: 'hullLv' as const,
                  title: 'Titanium Hull Armor',
                  desc: '+25 Max HP per level',
                  icon: <Heart className="w-5 h-5 text-emerald-400" />,
                  lv: progress.upgrades.hullLv,
                },
                {
                  key: 'shieldLv' as const,
                  title: 'Starting Energy Shield',
                  desc: '+25 starting forcefield shield per level',
                  icon: <Shield className="w-5 h-5 text-sky-400" />,
                  lv: progress.upgrades.shieldLv,
                },
              ].map((item) => {
                const cost = item.lv * 40;
                const canAfford = progress.coins >= cost;
                return (
                  <div
                    key={item.key}
                    className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
                        {item.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white">{item.title}</h3>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-sky-400">
                            Lv.{item.lv}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => buyUpgrade(item.key, cost)}
                      disabled={!canAfford}
                      className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 ${
                        canAfford
                          ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      <Coins className="w-3.5 h-3.5" />
                      <span>{cost}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => setScreen('menu')}
            className="w-full py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm"
          >
            Back to Launch Deck
          </button>
        </div>
      )}

      {/* ACTIVE GAMEPLAY CANVAS & HUD */}
      {screen === 'playing' && (
        <>
          <canvas ref={canvasRef} className="block w-full h-full" />

          {/* Top HUD Overlay */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              {/* Score & Wave */}
              <div>
                <div className="text-xl font-black tracking-wider text-white drop-shadow">
                  {hudScore.toLocaleString()}
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-sky-400">
                  <span>WAVE {hudWave}</span>
                  <span>·</span>
                  <span>WPN LV.{hudWeaponLv}</span>
                  <span>·</span>
                  <span className="text-amber-300">+{hudCoins} Coins</span>
                </div>
              </div>

              {/* Health & Shield Bars */}
              <div className="w-36 space-y-1.5">
                <div className="w-full h-2.5 bg-slate-900/90 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all"
                    style={{ width: `${Math.max(0, (hudHp / hudMaxHp) * 100)}%` }}
                  />
                </div>
                {hudShield > 0 && (
                  <div className="w-full h-2 bg-slate-900/90 rounded-full overflow-hidden border border-sky-800">
                    <div
                      className="h-full bg-sky-400 transition-all"
                      style={{ width: `${Math.min(100, hudShield)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Boss Health Bar */}
            {hudBoss && (
              <div className="w-full max-w-md mx-auto mt-1 bg-rose-950/80 border border-rose-700/80 rounded-xl p-2">
                <div className="flex justify-between text-[11px] font-bold text-rose-200 mb-1">
                  <span>{hudBoss.name}</span>
                  <span>
                    {hudBoss.hp} / {hudBoss.maxHp}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 to-amber-500 transition-all"
                    style={{ width: `${(hudBoss.hp / hudBoss.maxHp) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Interactive Touch Buttons (Nova Bomb & Return to Menu) */}
          <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between pointer-events-none">
            <button
              onClick={() => setScreen('menu')}
              className="pointer-events-auto p-3 rounded-2xl bg-slate-900/80 border border-slate-700 text-slate-200 active:scale-95"
              title="Exit to Menu"
            >
              <Pause className="w-5 h-5" />
            </button>

            <button
              onClick={() => triggerBombRef.current()}
              disabled={hudBombs <= 0}
              className="pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 disabled:opacity-35 text-slate-950 font-black text-xs shadow-lg shadow-orange-950/60 active:scale-95"
            >
              <Flame className="w-5 h-5 fill-current" />
              <span>NOVA BOMB ({hudBombs})</span>
            </button>
          </div>

          {/* GAME OVER MODAL */}
          {isGameOver && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5 z-50">
              <div className="w-full max-w-xs bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-2xl">
                <h2 className="text-2xl font-black text-rose-500">MISSION ENDED</h2>
                <div className="space-y-1 text-sm">
                  <p className="text-slate-400">
                    Final Score:{' '}
                    <span className="text-white font-bold">{hudScore.toLocaleString()}</span>
                  </p>
                  <p className="text-slate-400">
                    Wave Reached: <span className="text-sky-400 font-bold">Wave {hudWave}</span>
                  </p>
                  <p className="text-slate-400">
                    Coins Earned: <span className="text-amber-400 font-bold">+{hudCoins}</span>
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={() => {
                      setScreen('menu');
                      setTimeout(() => startNewGame(), 20);
                    }}
                    className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>PLAY AGAIN</span>
                  </button>
                  <button
                    onClick={() => setScreen('hangar')}
                    className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs"
                  >
                    Upgrade Ship ({progress.coins} Coins)
                  </button>
                  <button
                    onClick={() => setScreen('menu')}
                    className="w-full py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 font-semibold text-xs"
                  >
                    Main Menu
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
