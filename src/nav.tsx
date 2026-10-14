import { BookOpen, FolderKanban, LayoutDashboard, ListChecks, MessagesSquare, Palette, Settings, Sparkles, Users, type LucideIcon } from 'lucide-react'

export const NAV: [string, LucideIcon, string][] = [
  ['/', LayoutDashboard, 'Dashboard'],
  ['/projects', FolderKanban, 'Projects'],
  ['/board', MessagesSquare, 'Board'],
  ['/todos', ListChecks, 'To-dos'],
  ['/docs', BookOpen, 'Docs'],
  ['/people', Users, 'People'],
  ['/ask', Sparkles, 'Ask AI'],
  ['/design', Palette, 'Design lab'],
  ['/settings', Settings, 'Settings'],
]
