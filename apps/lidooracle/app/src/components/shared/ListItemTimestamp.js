import React from 'react'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'

export const ListItemTimestamp = ({ label, value }) => {
    return (
        <ListItem label={label}>
            <LoadableElement value={value}>{toDateTime(value)}</LoadableElement>
        </ListItem>
    )
}


const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDateTime(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);

    const [hours, minutes, seconds, day, month, year] = [
        zeroPad(date.getHours()),
        zeroPad(date.getMinutes()),
        zeroPad(date.getSeconds()),
        date.getDate(),
        months[date.getMonth()],
        date.getFullYear()
    ]

    return `${hours}:${minutes}:${seconds} ${month} ${day}, ${year}`
}

function zeroPad(number) {
    return String(number).padStart(2, "0")
}