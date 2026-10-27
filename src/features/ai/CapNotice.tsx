import { useEffect } from 'react'
import { App } from 'antd'
import { CAP_EVENT, type CapDetail } from '../../lib/ai/company'
import { useAi } from './store'

/** Shows a notice, wherever you are in the app, when today's company AI limit is reached. */
export function CapNotice() {
  const { notification } = App.useApp()
  useEffect(() => {
    const onCap = (e: Event) => {
      const { message } = (e as CustomEvent<CapDetail>).detail
      // One notice per day's limit, however many requests were running.
      notification.error({
        key: 'ai-daily-cap',
        message: 'Daily AI limit reached',
        description: message,
        duration: 0,
        placement: 'topRight',
      })
      void useAi.getState().refreshCompany()
    }
    window.addEventListener(CAP_EVENT, onCap)
    return () => window.removeEventListener(CAP_EVENT, onCap)
  }, [notification])
  return null
}
