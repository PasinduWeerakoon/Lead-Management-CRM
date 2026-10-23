import type { CSSProperties } from 'react'
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowsSort,
  IconBolt,
  IconBrackets,
  IconBrandLinkedin,
  IconBuilding,
  IconBuildingCommunity,
  IconCloudCheck,
  IconCloudOff,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconAlertTriangle,
  IconClockHour4,
  IconPlayerPlayFilled,
  IconPhone,
  IconMailCheck,
  IconCpu,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconCircleCheck,
  IconCircleMinus,
  IconColumns3,
  IconCopy,
  IconDatabaseExport,
  IconDeviceDesktop,
  IconDownload,
  IconExternalLink,
  IconFileSpreadsheet,
  IconFileText,
  IconFileUpload,
  IconFilter,
  IconFlag,
  IconFlask,
  IconHash,
  IconHelpCircle,
  IconInfoCircle,
  IconKey,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLetterT,
  IconLink,
  IconLoader2,
  IconLock,
  IconMail,
  IconMapPin,
  IconMessage2,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconSun,
  IconTable,
  IconTag,
  IconTags,
  IconTrash,
  IconTrendingUp,
  IconUpload,
  IconUser,
  IconUserCircle,
  IconUsersGroup,
  IconWorld,
  IconBriefcase,
  IconX,
  type Icon as TablerIcon,
} from '@tabler/icons-react'

/**
 * One consistent icon set for the whole app: Tabler (MIT), thin rounded outlines in the same
 * spirit as Clay's icons. Exported under the names the code already uses, so screens don't change.
 * Icons scale with the surrounding font size, like antd's own icons.
 */
interface IconProps {
  style?: CSSProperties
  className?: string
  spin?: boolean
  'aria-label'?: string
}

function make(Icon: TablerIcon, stroke = 1.5) {
  const C = ({ style, className, spin, ...rest }: IconProps) => (
    <span
      role="img"
      aria-hidden={rest['aria-label'] ? undefined : true}
      aria-label={rest['aria-label']}
      className={`anticon lx${spin ? ' lx-spin' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <Icon size="1.15em" stroke={stroke} />
    </span>
  )
  C.displayName = Icon.displayName
  return C
}

// Navigation & people
export const UserOutlined = make(IconUser)
export const PersonCircleOutlined = make(IconUserCircle)
export const TableOutlined = make(IconTable)
export const SettingOutlined = make(IconSettings)
export const BulbOutlined = make(IconSparkles)
export const TagsOutlined = make(IconTags)
export const TagOutlined = make(IconTag)
export const MenuUnfoldOutlined = make(IconLayoutSidebarLeftExpand)
export const MenuFoldOutlined = make(IconLayoutSidebarLeftCollapse)

// Actions
export const CloudUploadOutlined = make(IconUpload)
export const UploadOutlined = make(IconUpload)
export const DownloadOutlined = make(IconDownload)
export const CloudDownloadOutlined = make(IconDatabaseExport)
export const PlusOutlined = make(IconPlus, 1.75)
export const DeleteOutlined = make(IconTrash)
export const EditOutlined = make(IconPencil)
export const CopyOutlined = make(IconCopy)
export const RollbackOutlined = make(IconArrowBackUp)
export const SearchOutlined = make(IconSearch)
export const FilterOutlined = make(IconFilter)
export const SortAscendingOutlined = make(IconArrowsSort)
export const ThunderboltOutlined = make(IconBolt)
export const InsertRowRightOutlined = make(IconColumns3)
export const ApartmentOutlined = make(IconBrackets)

// Status & feedback
export const CheckOutlined = make(IconCheck, 2)
export const CheckCircleOutlined = make(IconCircleCheck)
export const CheckCircleFilled = make(IconCircleCheck, 2)
export const CloseOutlined = make(IconX, 1.75)
export const ExclamationCircleOutlined = make(IconAlertCircle)
export const QuestionCircleOutlined = make(IconHelpCircle)
export const InfoOutlined = make(IconInfoCircle)
export const MinusCircleOutlined = make(IconCircleMinus)
export const SafetyOutlined = make(IconShieldCheck)
export const LockOutlined = make(IconLock)
export const KeyOutlined = make(IconKey)
export const LoadingOutlined = (p: IconProps) => make(IconLoader2)({ ...p, spin: true })

// Chevrons
export const DownOutlined = make(IconChevronDown, 1.75)
export const UpOutlined = make(IconChevronUp, 1.75)
export const RightOutlined = make(IconChevronRight, 1.75)

// Data types (column headers use Clay-like type icons: T for text, # for numbers, link, building…)
export const FontSizeOutlined = make(IconLetterT)
export const NumberOutlined = make(IconHash)
export const LinkOutlined = make(IconLink)
export const ExportOutlined = make(IconExternalLink)
export const BankOutlined = make(IconBuilding)
export const WorldOutlined = make(IconWorld)
export const BriefcaseOutlined = make(IconBriefcase)
export const UsersGroupOutlined = make(IconUsersGroup)
export const EnvironmentOutlined = make(IconMapPin)
export const HqOutlined = make(IconBuildingCommunity)
export const CloudOutlined = make(IconCloudCheck)
export const CloudOffOutlined = make(IconCloudOff)
// Enrichment columns
export const FoundFilled = make(IconCircleCheckFilled)
export const NotFoundFilled = make(IconCircleXFilled)
export const WarningOutlined = make(IconAlertTriangle)
export const PendingOutlined = make(IconClockHour4)
export const PlayFilled = make(IconPlayerPlayFilled)
export const PhoneOutlined = make(IconPhone)
export const MailCheckOutlined = make(IconMailCheck)
export const TechOutlined = make(IconCpu)
export const CalendarOutlined = make(IconCalendar)
export const AppstoreOutlined = make(IconLayoutGrid)
export const RiseOutlined = make(IconTrendingUp)
export const FlagOutlined = make(IconFlag)
export const StarOutlined = make(IconHash)
export const MessageOutlined = make(IconMessage2)
export const MailOutlined = make(IconMail)

// Misc
export const SunOutlined = make(IconSun)
export const MoonOutlined = make(IconMoon)
export const DesktopOutlined = make(IconDeviceDesktop)
export const ExperimentOutlined = make(IconFlask)
export const InboxOutlined = make(IconFileUpload, 1.25)
export const FileTextOutlined = make(IconFileText)
export const FileExcelOutlined = make(IconFileSpreadsheet)
export const LinkedinFilled = make(IconBrandLinkedin)
