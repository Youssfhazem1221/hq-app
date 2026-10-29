// One stroke icon family (lucide-react) behind stable names: app icons + the 30 explainer enums (contracts.ts).
import {
  ArrowDown, ArrowRight, ArrowUp, Bell, BookMarked, BookOpen, Bot, Briefcase, Calendar, ChartColumn, ChartGantt, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleCheck, CircleCheckBig, CircleDot, CircleHelp, Clock, Cloud, Coins, Columns3, Contrast, Copy,
  Database, Ellipsis, ExternalLink, Eye, EyeOff, File as FileIcon, Flag, Focus, Folder, GitCommitHorizontal, Globe, GripVertical,
  HardDrive, History as HistoryIcon, House, Inbox, Info, Keyboard, Layers, LayoutGrid, LayoutPanelLeft, Leaf, Lightbulb,
  Link as LinkIcon, List, LoaderCircle, Lock, LogOut, Map as MapIcon, MapPin, Megaphone, Menu, MessageCircle, MessageSquare, Monitor,
  OctagonMinus, PanelLeft, Pause, Pencil, Pin, Play, Plug, Plus, RefreshCw, Route, Search, Send, Settings, SlidersHorizontal,
  SquareCheck, SquareKanban, Star, Sun, Moon, Table2, Target, TriangleAlert, Trophy, Type, Undo2, User, Users, WandSparkles,
  Webhook, X, Zap, type LucideIcon,
} from 'lucide-react'
import type { IconName } from './contracts'

/** The Pinwheel mark (8-blade peppermint pinwheel, 120 box). It stands in for the AI everywhere ('spark'). */
export const PW_PATH =
  'M60 60Q35.01 40.17 60.00 2.00A58 58 0 0 1 84.28 7.33Q49.01 38.26 60 60ZM60 60Q56.35 28.31 101.01 18.99A58 58 0 0 1 114.42 39.93Q67.60 36.86 60 60ZM60 60Q79.83 35.01 118.00 60.00A58 58 0 0 1 112.67 84.28Q81.74 49.01 60 60ZM60 60Q91.69 56.35 101.01 101.01A58 58 0 0 1 80.07 114.42Q83.14 67.60 60 60ZM60 60Q84.99 79.83 60.00 118.00A58 58 0 0 1 35.72 112.67Q70.99 81.74 60 60ZM60 60Q63.65 91.69 18.99 101.01A58 58 0 0 1 5.58 80.07Q52.40 83.14 60 60ZM60 60Q40.17 84.99 2.00 60.00A58 58 0 0 1 7.33 35.72Q38.26 70.99 60 60ZM60 60Q28.31 63.65 18.99 18.99A58 58 0 0 1 39.93 5.58Q36.86 52.40 60 60Z'
const Pinwheel = (({ className, ...p }: { className?: string }) => (
  <svg viewBox="0 0 120 120" className={(className || '') + ' pw'} {...p}>
    <path d={PW_PATH} />
  </svg>
)) as unknown as LucideIcon

export const ICONS: Record<string, LucideIcon> = {
  // app
  home: House, projects: SquareKanban, tasks: SquareCheck, board: MessageSquare, settings: SlidersHorizontal, search: Search,
  plus: Plus, wand: WandSparkles, moon: Moon, sun: Sun, chevR: ChevronRight, chevL: ChevronLeft, chevD: ChevronDown, up: ArrowUp,
  down: ArrowDown, dots: Ellipsis, x: X, info: Info, inbox: Inbox, cal: Calendar, history: HistoryIcon, eye: Eye, eyeOff: EyeOff,
  sidebar: PanelLeft, menu: Menu, table: Table2, focus: Focus, leaf: Leaf, type: Type, contrast: Contrast, undo: Undo2, copy: Copy,
  ext: ExternalLink, play: Play, pause: Pause, done: CircleCheck, doing: CircleDot, thought: MessageCircle, update: Megaphone,
  keyboard: Keyboard, grid: LayoutGrid, cols: Columns3, list: List, gantt: ChartGantt, link: LinkIcon, commit: GitCommitHorizontal,
  hook: Webhook, gear: Settings, grip: GripVertical, plug: Plug, cloud: Cloud, local: HardDrive, refresh: RefreshCw,
  alert: TriangleAlert, ok: CircleCheckBig, send: Send, logout: LogOut, loader: LoaderCircle, star: Star, target: Target,
  question: CircleHelp, edit: Pencil,
  // explainer enums
  flag: Flag, route: Route, chart: ChartColumn, users: Users, arrow: ArrowRight, spark: Pinwheel, file: FileIcon, folder: Folder,
  db: Database, bell: Bell, pc: Monitor, repo: BookMarked, globe: Globe, lock: Lock, check: Check, clock: Clock, idea: Lightbulb,
  layers: Layers, map: MapIcon, pin: MapPin, coins: Coins, briefcase: Briefcase, layout: LayoutPanelLeft, user: User, bot: Bot,
  zap: Zap, win: Trophy, learned: BookOpen, blocked: OctagonMinus, pinned: Pin,
}

export const hasIcon = (name: unknown): name is IconName => typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, name)

export type IconSize = 's' | 'm' | 'l'

/** `<Icon name="home"/>`: decorative by default (aria-hidden); pass `label` to make it a spoken image. An unknown name
 *  draws a small neutral dot instead of throwing. */
export function Icon({ name, size = 'm', className, label }: { name: IconName; size?: IconSize; className?: string; label?: string }) {
  const C = hasIcon(name) ? ICONS[name] : null
  const cls = 'i' + (size === 's' ? ' s' : size === 'l' ? ' l' : '') + (className ? ' ' + className : '')
  if (!C) return <span className={cls + ' i-dot'} aria-hidden="true" />
  return label ? <C className={cls} role="img" aria-label={label} /> : <C className={cls} aria-hidden="true" />
}
